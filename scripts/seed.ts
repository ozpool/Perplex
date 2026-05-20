/**
 * Phase 0 seed script.
 *
 * After contracts are deployed via `forge script script/Deploy.s.sol`,
 * this script:
 *   1. Lists 3 markets (BTC-USD, ETH-USD, SOL-USD) on MarketRegistry
 *   2. Sets initial MockOracle prices
 *   3. Funds 5 test wallets with 100k mock USDC each + deposits 50k each into vault
 *
 * Idempotent: safe to re-run on a fresh anvil chain.
 *
 * Requires: deployment addresses written to `contracts/deployments/anvil.json`
 *           by the Foundry deploy script.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import fs from "node:fs";
import path from "node:path";

const RPC_URL = process.env.RPC_URL ?? "http://localhost:8545";
const DEPLOYMENTS = path.resolve(__dirname, "../contracts/deployments/anvil.json");

type DeploymentMap = {
  CollateralVault: Address;
  PositionRegistry: Address;
  MarketRegistry: Address;
  MockOracle: Address;
  MockUSDC: Address;
  SyntheticCounterparty: Address;
};

const deployments: DeploymentMap = JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf-8"));

// Anvil deterministic accounts (DO NOT USE ON MAINNET)
const ANVIL_KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // deployer
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];

const deployer = privateKeyToAccount(ANVIL_KEYS[0]);
const traders = ANVIL_KEYS.slice(1).map(privateKeyToAccount);

const pub = createPublicClient({ chain: foundry, transport: http(RPC_URL) });
const wallet = createWalletClient({ chain: foundry, transport: http(RPC_URL), account: deployer });

const id = (s: string) => keccak256(toHex(s)) as Hex;

const MARKETS = [
  { key: "btc-usd", price: parseUnits("100000", 18), imBps: 500, mmBps: 250, liqBonusBps: 100, takerBps: 5, makerBps: -2 },
  { key: "eth-usd", price: parseUnits("3500", 18), imBps: 500, mmBps: 250, liqBonusBps: 100, takerBps: 5, makerBps: -2 },
  { key: "sol-usd", price: parseUnits("200", 18), imBps: 1000, mmBps: 500, liqBonusBps: 150, takerBps: 7, makerBps: -2 },
];

async function main() {
  console.log("Seeding Perplex local devnet");
  console.log("  deployer ", deployer.address);
  console.log("  deployments at", DEPLOYMENTS);

  // 1. Seed oracle prices
  for (const m of MARKETS) {
    const hash = await wallet.writeContract({
      address: deployments.MockOracle,
      abi: MOCK_ORACLE_ABI,
      functionName: "setPrice",
      args: [id(m.key), m.price],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`  oracle ${m.key.padEnd(8)} = ${m.price}`);
  }

  // 2. List markets
  for (const m of MARKETS) {
    const hash = await wallet.writeContract({
      address: deployments.MarketRegistry,
      abi: MARKET_REGISTRY_ABI,
      functionName: "listMarket",
      args: [id(m.key), m.imBps, m.mmBps, m.liqBonusBps, m.takerBps, m.makerBps],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`  market ${m.key.padEnd(8)} listed`);
  }

  // 3. Fund test wallets with mock USDC, deposit half into vault
  const MOCK_USDC_AMT = parseUnits("100000", 6); // 100k USDC (6 decimals)
  const DEPOSIT_AMT = parseUnits("50000", 6);

  for (const t of traders) {
    const mintHash = await wallet.writeContract({
      address: deployments.MockUSDC,
      abi: MOCK_USDC_ABI,
      functionName: "mint",
      args: [t.address, MOCK_USDC_AMT],
    });
    await pub.waitForTransactionReceipt({ hash: mintHash });

    const traderWallet = createWalletClient({
      chain: foundry,
      transport: http(RPC_URL),
      account: t,
    });

    const approveHash = await traderWallet.writeContract({
      address: deployments.MockUSDC,
      abi: MOCK_USDC_ABI,
      functionName: "approve",
      args: [deployments.CollateralVault, DEPOSIT_AMT],
    });
    await pub.waitForTransactionReceipt({ hash: approveHash });

    const depositHash = await traderWallet.writeContract({
      address: deployments.CollateralVault,
      abi: COLLATERAL_VAULT_ABI,
      functionName: "deposit",
      args: [DEPOSIT_AMT],
    });
    await pub.waitForTransactionReceipt({ hash: depositHash });

    console.log(`  trader ${t.address} funded with 100k USDC, deposited 50k`);
  }

  console.log("\nSeed complete.");
}

// Minimal ABIs — replace with generated ABIs from `forge build` artefacts when wiring real contracts.
const MOCK_ORACLE_ABI = [
  { type: "function", name: "setPrice", stateMutability: "nonpayable", inputs: [{ name: "marketId", type: "bytes32" }, { name: "newPriceX18", type: "uint256" }], outputs: [] },
] as const;
const MARKET_REGISTRY_ABI = [
  { type: "function", name: "listMarket", stateMutability: "nonpayable", inputs: [{ name: "marketId", type: "bytes32" }, { name: "imBps", type: "uint16" }, { name: "mmBps", type: "uint16" }, { name: "liqBonusBps", type: "uint16" }, { name: "takerBps", type: "uint16" }, { name: "makerBps", type: "int16" }], outputs: [] },
] as const;
const MOCK_USDC_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;
const COLLATERAL_VAULT_ABI = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
