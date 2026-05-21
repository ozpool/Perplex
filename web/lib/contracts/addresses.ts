import type { Address } from "viem";

export interface ContractAddresses {
  collateralVault: Address;
  usdc: Address;
}

/**
 * Per-chain deployment addresses. Anvil entries mirror
 * `~/Desktop/perplex/deployments/anvil.json` — keep in sync when redeploying.
 * Arbitrum One and Arbitrum Sepolia entries are placeholders for now; the
 * UI will disable on-chain actions on those chains until they are filled in.
 */
const ADDRESSES: Partial<Record<number, ContractAddresses>> = {
  31337: {
    collateralVault: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    usdc: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  },
};

export function getAddresses(chainId: number | undefined): ContractAddresses | null {
  if (chainId === undefined) return null;
  return ADDRESSES[chainId] ?? null;
}

export const USDC_DECIMALS = 6;
