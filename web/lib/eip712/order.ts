import { keccak256, toHex, parseUnits } from "viem";
import type { MarketId, Side, OrderType, TimeInForce } from "@/lib/types/contract";

export const ORDER_DOMAIN = (chainId: number, verifyingContract: `0x${string}`) =>
  ({
    name: "Perplex",
    version: "1",
    chainId,
    verifyingContract,
  }) as const;

export const ORDER_TYPES = {
  Order: [
    { name: "owner", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "side", type: "uint8" },
    { name: "orderType", type: "uint8" },
    { name: "price", type: "uint256" },
    { name: "qty", type: "uint256" },
    { name: "timeInForce", type: "uint8" },
    { name: "reduceOnly", type: "bool" },
    { name: "postOnly", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "expiryTsSec", type: "uint64" },
  ],
} as const;

const SIDE: Record<Side, number> = { buy: 0, sell: 1 };
const TYPE: Record<OrderType, number> = { market: 0, limit: 1 };
const TIF: Record<TimeInForce, number> = { gtc: 0, ioc: 1, fok: 2 };

export function marketIdHash(marketId: MarketId): `0x${string}` {
  return keccak256(toHex(marketId));
}

export interface BuildOrderInput {
  owner: `0x${string}`;
  marketId: MarketId;
  side: Side;
  type: OrderType;
  price: string;
  qty: string;
  timeInForce: TimeInForce;
  reduceOnly: boolean;
  postOnly: boolean;
  nonce: string;
  expiryTsSec?: number;
}

export function buildOrderTypedMessage(input: BuildOrderInput) {
  return {
    owner: input.owner,
    marketId: marketIdHash(input.marketId),
    side: SIDE[input.side],
    orderType: TYPE[input.type],
    price: parseUnits(input.price, 18),
    qty: parseUnits(input.qty, 18),
    timeInForce: TIF[input.timeInForce],
    reduceOnly: input.reduceOnly,
    postOnly: input.postOnly,
    nonce: BigInt(input.nonce),
    expiryTsSec: BigInt(input.expiryTsSec ?? 0),
  };
}
