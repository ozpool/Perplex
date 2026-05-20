/**
 * Helper: sign a SettlementEngine batch via EIP-712 using viem.
 *
 * Mirrors contracts/src/SettlementEngine.sol typehashes exactly so the off-chain
 * signature recovers to the operator address.
 */
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type Fill = {
  user: Address;
  marketId: Hex;
  sizeDelta: bigint;
  priceX18: bigint;
  fee: bigint;
};

const TYPES = {
  Fill: [
    { name: "user", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "sizeDelta", type: "int256" },
    { name: "priceX18", type: "uint256" },
    { name: "fee", type: "int256" },
  ],
  Batch: [
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "fills", type: "Fill[]" },
  ],
} as const;

export async function signBatch(args: {
  operatorPk: Hex;
  chainId: number;
  settlementEngine: Address;
  fills: Fill[];
  nonce: bigint;
  deadline: bigint;
}): Promise<Hex> {
  const acct = privateKeyToAccount(args.operatorPk);
  return acct.signTypedData({
    domain: {
      name: "Perplex",
      version: "1",
      chainId: args.chainId,
      verifyingContract: args.settlementEngine,
    },
    types: TYPES,
    primaryType: "Batch",
    message: {
      nonce: args.nonce,
      deadline: args.deadline,
      fills: args.fills,
    },
  });
}
