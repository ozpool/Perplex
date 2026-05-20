/**
 * Local devnet seed.
 *
 * After contracts are deployed via `forge script script/Deploy.s.sol`,
 * this script funds 5 test wallets with 100k mock USDC each and deposits
 * 50k into the CollateralVault from each wallet.
 *
 * Re-running on the same anvil chain credits another 100k mint + 50k deposit
 * to each trader. Use `make dev-reset` for fresh state.
 */
import { keccak256, parseUnits, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { loadAbi } from "./lib/abi.js";
import { ANVIL_KEYS, loadDeployments, publicClient, walletClient } from "./lib/env.js";

const deployments = loadDeployments("anvil");
const usdcAbi = loadAbi("MockUSDC.sol", "MockUSDC");
const vaultAbi = loadAbi("CollateralVault.sol", "CollateralVault");
const oracleAbi = loadAbi("MockOracle.sol", "MockOracle");
const registryAbi = loadAbi("MarketRegistry.sol", "MarketRegistry");

const pub = publicClient();
const id = (s: string) => keccak256(toHex(s));

const TRADER_KEYS: Hex[] = ANVIL_KEYS.slice(1, 6);
const MINT_AMT = parseUnits("100000", 6);
const DEPOSIT_AMT = parseUnits("50000", 6);

async function logMarketState() {
  for (const marketKey of ["btc-usd", "eth-usd", "sol-usd"] as const) {
    const active = await pub.readContract({
      address: deployments.MarketRegistry,
      abi: registryAbi,
      functionName: "isMarketActive",
      args: [id(marketKey)],
    });
    const price = await pub.readContract({
      address: deployments.MockOracle,
      abi: oracleAbi,
      functionName: "priceX18",
      args: [id(marketKey)],
    });
    console.log(`  market ${marketKey.padEnd(8)} active=${active} price=${price}`);
  }
}

async function main() {
  console.log("Seeding Perplex local devnet");
  console.log("  CollateralVault   ", deployments.CollateralVault);
  console.log("  PositionRegistry  ", deployments.PositionRegistry);
  console.log("  MarketRegistry    ", deployments.MarketRegistry);
  console.log("  MockOracle        ", deployments.MockOracle);
  console.log("  MockUSDC          ", deployments.MockUSDC);
  console.log("");

  await logMarketState();
  console.log("");

  for (const key of TRADER_KEYS) {
    const acct = privateKeyToAccount(key);
    const trader = walletClient(key);

    const mintTx = await trader.writeContract({
      address: deployments.MockUSDC,
      abi: usdcAbi,
      functionName: "mint",
      args: [acct.address, MINT_AMT],
      account: acct,
      chain: null,
    });
    await pub.waitForTransactionReceipt({ hash: mintTx });

    const approveTx = await trader.writeContract({
      address: deployments.MockUSDC,
      abi: usdcAbi,
      functionName: "approve",
      args: [deployments.CollateralVault, DEPOSIT_AMT],
      account: acct,
      chain: null,
    });
    await pub.waitForTransactionReceipt({ hash: approveTx });

    const depositTx = await trader.writeContract({
      address: deployments.CollateralVault,
      abi: vaultAbi,
      functionName: "deposit",
      args: [DEPOSIT_AMT],
      account: acct,
      chain: null,
    });
    await pub.waitForTransactionReceipt({ hash: depositTx });

    const bal = await pub.readContract({
      address: deployments.CollateralVault,
      abi: vaultAbi,
      functionName: "balances",
      args: [acct.address],
    });
    console.log(`  trader ${acct.address} vaultBalance=${bal}`);
  }

  console.log("\nSeed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
