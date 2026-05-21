"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { parseUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { qk, useBalance } from "@/lib/api/queries";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { NumberDisplay } from "@/components/ui/NumberDisplay";
import { EmptyState } from "@/components/common/EmptyState";
import { useUi } from "@/lib/store/ui-store";
import { cn } from "@/lib/cn";
import { collateralVaultAbi, erc20Abi } from "@/lib/contracts/abis";
import { getAddresses, USDC_DECIMALS } from "@/lib/contracts/addresses";

type Mode = "deposit" | "withdraw";

export default function WalletPage() {
  const { address, status } = useAccount();
  const chainId = useChainId();
  const addresses = getAddresses(chainId);
  const qc = useQueryClient();
  const { data: balance } = useBalance();
  const pushToast = useUi((s) => s.pushToast);
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");

  const walletBal = balance ? Number(balance.walletUsdcBalance) : 0;
  const vaultBal = balance ? Number(balance.vaultBalanceUsdc) : 0;
  const source = mode === "deposit" ? walletBal : vaultBal;
  const target = mode === "deposit" ? vaultBal : walletBal;
  const amt = Number(amount) || 0;
  const insufficient = amt > source;

  // USDC allowance for the vault — only relevant in deposit mode.
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: erc20Abi,
    address: addresses?.usdc,
    functionName: "allowance",
    args: address && addresses ? [address, addresses.collateralVault] : undefined,
    query: { enabled: !!address && !!addresses, staleTime: 5_000 },
  });

  const amountWei = useMemo(
    () => (amt > 0 ? parseUnits(amount, USDC_DECIMALS) : 0n),
    [amount, amt],
  );
  const needsApproval =
    mode === "deposit" && !!addresses && (allowance ?? 0n) < amountWei && amt > 0;

  const { writeContractAsync, isPending: writePending } = useWriteContract();
  const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>();
  const { isLoading: txConfirming, isSuccess: txMined } = useWaitForTransactionReceipt({
    hash: pendingHash,
  });

  // We need to react to the on-chain receipt becoming `success`, but only once
  // per hash — keeping the work in an effect would otherwise re-fire each
  // render. The ref records which hash we've already processed.
  const handledHashRef = useRef<`0x${string}` | null>(null);
  useEffect(() => {
    if (!txMined || !pendingHash) return;
    if (handledHashRef.current === pendingHash) return;
    handledHashRef.current = pendingHash;
    pushToast({
      kind: "success",
      title: mode === "deposit" ? "Deposit confirmed" : "Withdrawal confirmed",
      body: `Tx ${pendingHash.slice(0, 10)}… mined`,
    });
    setPendingHash(undefined);
    setAmount("");
    qc.invalidateQueries({ queryKey: qk.balance });
    qc.invalidateQueries({ queryKey: qk.positions });
    refetchAllowance();
  }, [txMined, mode, pendingHash, pushToast, qc, refetchAllowance]);

  async function onSubmit() {
    if (!amt || !addresses || !address) return;
    try {
      if (mode === "deposit") {
        if (needsApproval) {
          const hash = await writeContractAsync({
            abi: erc20Abi,
            address: addresses.usdc,
            functionName: "approve",
            args: [addresses.collateralVault, amountWei],
          });
          pushToast({
            kind: "info",
            title: "Approval submitted",
            body: `Tx ${hash.slice(0, 10)}… — sign deposit next`,
          });
          setPendingHash(hash);
          return; // user clicks again to deposit once approval lands
        }
        const hash = await writeContractAsync({
          abi: collateralVaultAbi,
          address: addresses.collateralVault,
          functionName: "deposit",
          args: [amountWei],
        });
        pushToast({ kind: "info", title: "Deposit submitted", body: `Tx ${hash.slice(0, 10)}…` });
        setPendingHash(hash);
      } else {
        const hash = await writeContractAsync({
          abi: collateralVaultAbi,
          address: addresses.collateralVault,
          functionName: "withdraw",
          args: [amountWei],
        });
        pushToast({ kind: "info", title: "Withdrawal submitted", body: `Tx ${hash.slice(0, 10)}…` });
        setPendingHash(hash);
      }
    } catch (e) {
      pushToast({
        kind: "error",
        title: "Transaction failed",
        body: e instanceof Error ? e.message : "Wallet rejected the request",
      });
    }
  }

  const submitting = writePending || txConfirming;
  const ctaLabel = (() => {
    if (submitting && needsApproval) return "Approving…";
    if (submitting) return mode === "deposit" ? "Depositing…" : "Withdrawing…";
    if (needsApproval) return "Approve USDC";
    return mode === "deposit" ? "Deposit USDC" : "Withdraw USDC";
  })();

  return (
    <div className="px-3 sm:px-5 py-4 sm:py-6 max-w-screen-md w-full mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-xl text-fg font-semibold">Wallet</h1>
        <p className="text-sm text-fg-muted">USDC bridge to your trading vault.</p>
      </div>

      {status !== "connected" ? (
        <Card raised>
          <CardHeader>Connect wallet</CardHeader>
          <div className="p-6">
            <EmptyState
              title="Wallet not connected"
              description="Connect a wallet from the top-right to deposit USDC and start trading."
            />
          </div>
        </Card>
      ) : !addresses ? (
        <Card raised>
          <CardHeader>Unsupported network</CardHeader>
          <div className="p-6">
            <EmptyState
              title={`Perplex is not deployed on chain ${chainId} yet`}
              description="Switch to Arbitrum or local Anvil (31337) to deposit USDC."
            />
          </div>
        </Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <BalanceCard label="Wallet USDC" value={walletBal} hint={shortAddr(address ?? "")} accent="info" />
            <BalanceCard label="Vault USDC" value={vaultBal} hint="Available for margin" accent="accent" />
          </div>

          <Card raised>
            <CardHeader>
              <div className="flex items-center gap-1 bg-bg-2 p-0.5 rounded-[var(--radius-sm)] border border-border">
                {(["deposit", "withdraw"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "h-7 px-3 text-[12px] rounded-[3px] font-medium",
                      mode === m ? "bg-bg-hover text-fg" : "text-fg-muted hover:text-fg"
                    )}
                  >
                    {m === "deposit" ? "Deposit" : "Withdraw"}
                  </button>
                ))}
              </div>
            </CardHeader>
            <div className="p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3 text-xs">
                <FromTo direction={mode} />
              </div>
              <Input
                label="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                suffix="USDC"
                error={insufficient ? "Exceeds available balance" : undefined}
              />
              <div className="flex gap-2">
                {[0.25, 0.5, 0.75, 1].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => setAmount((source * pct).toFixed(2))}
                    className="flex-1 h-7 text-[11px] text-fg-muted hover:text-fg border border-border rounded-[var(--radius-xs)]"
                  >
                    {pct === 1 ? "MAX" : `${pct * 100}%`}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1 text-[11px] border-t border-border pt-3">
                <RowKV label="Available" value={`$${source.toFixed(2)}`} />
                <RowKV label="After transfer" value={`$${(target + amt).toFixed(2)}`} />
                <RowKV label="Network fee" value="~$0.12" muted />
              </div>
              <Button
                size="lg"
                block
                variant="primary"
                loading={submitting}
                disabled={!amt || insufficient || submitting}
                onClick={onSubmit}
              >
                {ctaLabel}
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function BalanceCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  accent: "info" | "accent";
}) {
  const ring = accent === "info" ? "var(--info)" : "var(--accent)";
  return (
    <Card raised className="p-4 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-0 right-0 size-32 rounded-full blur-3xl opacity-30"
        style={{ background: ring }}
      />
      <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">{label}</div>
      <NumberDisplay value={value} decimals={2} prefix="$" size="xl" />
      <div className="text-[11px] text-fg-muted mt-1 font-mono">{hint}</div>
    </Card>
  );
}

function FromTo({ direction }: { direction: Mode }) {
  const from = direction === "deposit" ? "Wallet" : "Vault";
  const to = direction === "deposit" ? "Vault" : "Wallet";
  return (
    <div className="flex items-center gap-3 text-fg-muted">
      <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-border text-fg">{from}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
      <span className="px-2 py-1 rounded-[var(--radius-sm)] border border-border text-fg">{to}</span>
    </div>
  );
}

function RowKV({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-fg-muted">{label}</span>
      <span className={cn("font-mono tabular-nums", muted ? "text-fg-mid" : "text-fg")}>{value}</span>
    </div>
  );
}

function shortAddr(a: string): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
