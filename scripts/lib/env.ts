import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

export type Deployments = {
  MockUSDC: Address;
  MockOracle: Address;
  MarketRegistry: Address;
  PositionRegistry: Address;
  CollateralVault: Address;
  SettlementEngine: Address;
  LiquidationEngine: Address;
  owner: Address;
  chainId: number;
};

export function loadDeployments(network = "anvil"): Deployments {
  const file = path.join(REPO_ROOT, "deployments", `${network}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Deployments file not found: ${file}\n` +
        `Run: cd contracts && forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Deployments;
}

export const RPC_URL = process.env.RPC_URL ?? "http://localhost:8545";

export const ANVIL_KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];

export function publicClient(): PublicClient {
  return createPublicClient({ chain: foundry, transport: http(RPC_URL) });
}

export function walletClient(pk: Hex): WalletClient {
  return createWalletClient({
    chain: foundry,
    transport: http(RPC_URL),
    account: privateKeyToAccount(pk),
  });
}
