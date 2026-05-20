/**
 * Phase 1+2 smoke — deposit / withdraw end-to-end against local devnet.
 *
 * Asserts:
 *   1. Mint + approve + deposit increments vault balance.
 *   2. Withdraw decrements vault balance and returns USDC to wallet.
 *   3. After a fill submitted via SettlementEngine.applyBatch (EIP-712 signed by
 *      the operator), a subsequent withdraw is blocked because the open position's
 *      initial margin exceeds the remaining free collateral.
 *
 * Exit 0 = all assertions pass. Non-zero = abort.
 */
import { keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { loadAbi } from "./lib/abi.js";
import { ANVIL_KEYS, loadDeployments, publicClient, walletClient } from "./lib/env.js";
import { signBatch, type Fill } from "./lib/settlement.js";

const deployments = loadDeployments("anvil");
const usdcAbi = loadAbi("MockUSDC.sol", "MockUSDC");
const vaultAbi = loadAbi("CollateralVault.sol", "CollateralVault");
const engineAbi = loadAbi("SettlementEngine.sol", "SettlementEngine");

const pub = publicClient();
const id = (s: string): Hex => keccak256(toHex(s));

// Use an anvil key NOT seeded by scripts/seed.ts (which uses indices 1..5) so the
// post-fill withdraw assertion isn't masked by pre-funded collateral.
const DEPOSITOR_KEY: Hex = ANVIL_KEYS[9];
const OPERATOR_KEY: Hex = ANVIL_KEYS[0]; // Deploy.s.sol sets operator = deployer.

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

async function balanceOfVault(user: Address): Promise<bigint> {
  return (await pub.readContract({
    address: deployments.CollateralVault,
    abi: vaultAbi,
    functionName: "balances",
    args: [user],
  })) as bigint;
}

async function balanceOfUSDC(user: Address): Promise<bigint> {
  return (await pub.readContract({
    address: deployments.MockUSDC,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [user],
  })) as bigint;
}

async function main() {
  const acct = privateKeyToAccount(DEPOSITOR_KEY);
  const trader = walletClient(DEPOSITOR_KEY);
  const operator = walletClient(OPERATOR_KEY);
  const operatorAcct = privateKeyToAccount(OPERATOR_KEY);

  console.log(`smoke-deposit: depositor = ${acct.address}`);

  const SEED = parseUnits("10000", 6);
  const DEPOSIT = parseUnits("1000", 6);
  const WITHDRAW = parseUnits("400", 6);

  // Mint + approve
  let tx = await trader.writeContract({
    address: deployments.MockUSDC,
    abi: usdcAbi,
    functionName: "mint",
    args: [acct.address, SEED],
    account: acct,
    chain: null,
  });
  await pub.waitForTransactionReceipt({ hash: tx });

  tx = await trader.writeContract({
    address: deployments.MockUSDC,
    abi: usdcAbi,
    functionName: "approve",
    args: [deployments.CollateralVault, SEED],
    account: acct,
    chain: null,
  });
  await pub.waitForTransactionReceipt({ hash: tx });

  // 1. deposit
  const vaultBefore = await balanceOfVault(acct.address);
  const usdcBefore = await balanceOfUSDC(acct.address);

  tx = await trader.writeContract({
    address: deployments.CollateralVault,
    abi: vaultAbi,
    functionName: "deposit",
    args: [DEPOSIT],
    account: acct,
    chain: null,
  });
  await pub.waitForTransactionReceipt({ hash: tx });

  assert(
    (await balanceOfVault(acct.address)) === vaultBefore + DEPOSIT,
    "vault balance did not increment by DEPOSIT",
  );
  assert((await balanceOfUSDC(acct.address)) === usdcBefore - DEPOSIT, "usdc balance did not decrement by DEPOSIT");
  console.log(`  [1] deposit OK (+${DEPOSIT})`);

  // 2. withdraw
  const vaultPre2 = await balanceOfVault(acct.address);
  const usdcPre2 = await balanceOfUSDC(acct.address);

  tx = await trader.writeContract({
    address: deployments.CollateralVault,
    abi: vaultAbi,
    functionName: "withdraw",
    args: [WITHDRAW],
    account: acct,
    chain: null,
  });
  await pub.waitForTransactionReceipt({ hash: tx });

  assert(
    (await balanceOfVault(acct.address)) === vaultPre2 - WITHDRAW,
    "vault balance did not decrement by WITHDRAW",
  );
  assert((await balanceOfUSDC(acct.address)) === usdcPre2 + WITHDRAW, "usdc balance did not increment by WITHDRAW");
  console.log(`  [2] withdraw OK (-${WITHDRAW})`);

  // 3. Submit a one-fill batch through SettlementEngine: alice goes long 1 BTC at 100k.
  //    Operator (= deployer) signs the EIP-712 typed-data batch.
  const fills: Fill[] = [
    {
      user: acct.address,
      marketId: id("btc-usd"),
      sizeDelta: 1n * 10n ** 18n,
      priceX18: 100_000n * 10n ** 18n,
      fee: 0n,
    },
  ];
  const nonce = BigInt(Math.floor(Date.now()));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const signature = await signBatch({
    operatorPk: OPERATOR_KEY,
    chainId: deployments.chainId,
    settlementEngine: deployments.SettlementEngine,
    fills,
    nonce,
    deadline,
  });

  tx = await operator.writeContract({
    address: deployments.SettlementEngine,
    abi: engineAbi,
    functionName: "applyBatch",
    args: [fills, nonce, deadline, signature],
    account: operatorAcct,
    chain: null,
  });
  await pub.waitForTransactionReceipt({ hash: tx });

  let blocked = false;
  try {
    await trader.writeContract({
      address: deployments.CollateralVault,
      abi: vaultAbi,
      functionName: "withdraw",
      args: [parseUnits("100", 6)],
      account: acct,
      chain: null,
    });
  } catch (e) {
    blocked = true;
    const msg = (e as Error).message ?? "";
    assert(msg.includes("WithdrawalBlocked"), `expected WithdrawalBlocked, got: ${msg.slice(0, 200)}`);
  }
  assert(blocked, "expected withdraw to revert after applyBatch, but it succeeded");
  console.log(`  [3] withdraw blocked after fill (WithdrawalBlocked) OK`);

  console.log("\nsmoke-deposit: PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
