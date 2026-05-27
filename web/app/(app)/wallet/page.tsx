"use client";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useBalance } from "@/lib/api/queries";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { NumberDisplay } from "@/components/ui/NumberDisplay";
import { EmptyState } from "@/components/common/EmptyState";
import { useUi } from "@/lib/store/ui-store";
import { usdc6ToDollars } from "@/lib/format/number";
import { cn } from "@/lib/cn";

type Mode = "deposit" | "withdraw";

export default function WalletPage() {
  const { address, status } = useAccount();
  const { data: balance } = useBalance();
  const pushToast = useUi((s) => s.pushToast);
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const walletBal = balance ? usdc6ToDollars(balance.walletUsdcBalance) : 0;
  const vaultBal = balance ? usdc6ToDollars(balance.vaultBalanceUsdc) : 0;
  const source = mode === "deposit" ? walletBal : vaultBal;
  const target = mode === "deposit" ? vaultBal : walletBal;
  const amt = Number(amount) || 0;
  const insufficient = amt > source;

  async function onSubmit() {
    if (!amt) return;
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 800));
    setSubmitting(false);
    pushToast({
      kind: "success",
      title: mode === "deposit" ? "Deposit submitted" : "Withdrawal submitted",
      body: `${amt.toFixed(2)} USDC · pending confirmation`,
    });
    setAmount("");
  }

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
                <RowKV label="Network fee" value="est. on mainnet" muted />
              </div>
              <Button
                size="lg"
                block
                variant="primary"
                loading={submitting}
                disabled={!amt || insufficient}
                onClick={onSubmit}
              >
                {mode === "deposit" ? "Deposit USDC" : "Withdraw USDC"}
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
