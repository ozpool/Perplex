"use client";
import { useCallback } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { usePlaceOrder } from "@/lib/api/queries";
import { useUi } from "@/lib/store/ui-store";
import {
  buildOrderTypedMessage,
  ORDER_DOMAIN,
  ORDER_TYPES,
} from "@/lib/eip712/order";
import { nowTsNs } from "@/lib/format/number";
import type { OrderRequest, Position } from "@/lib/types/contract";

const SETTLEMENT_PLACEHOLDER = "0x0000000000000000000000000000000000000000" as const;

// Flatten an open position with a single click: post a same-size IOC market
// order on the opposite side with reduceOnly=true so the edge can never
// accidentally flip the user into the other direction.
export function useClosePosition() {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const place = usePlaceOrder();
  const pushToast = useUi((s) => s.pushToast);
  const celebrate = useUi((s) => s.celebrate);

  return useCallback(
    async (position: Position) => {
      if (!address) {
        pushToast({ kind: "error", title: "Connect wallet first" });
        return;
      }

      const side = position.side === "long" ? "sell" : "buy";
      const clientOrderId = `close_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const nonce = nowTsNs();

      let signature = "0x0000";
      try {
        if (chainId) {
          const message = buildOrderTypedMessage({
            owner: address,
            marketId: position.marketId,
            side,
            type: "market",
            price: "0",
            qty: position.size,
            timeInForce: "ioc",
            reduceOnly: true,
            postOnly: false,
            nonce,
          });
          signature = await signTypedDataAsync({
            domain: ORDER_DOMAIN(chainId, SETTLEMENT_PLACEHOLDER),
            types: ORDER_TYPES,
            primaryType: "Order",
            message,
          });
        }
      } catch (e) {
        pushToast({
          kind: "error",
          title: "Close cancelled",
          body: e instanceof Error ? e.message : undefined,
        });
        return;
      }

      const req: OrderRequest = {
        marketId: position.marketId,
        side,
        type: "market",
        price: "0",
        qty: position.size,
        timeInForce: "ioc",
        reduceOnly: true,
        postOnly: false,
        clientOrderId,
        nonce,
        signature,
      };

      try {
        await place.mutateAsync(req);
        const base = position.marketId.split("-")[0].toUpperCase();
        const body = `${position.side === "long" ? "Long" : "Short"} ${position.size} ${base} closed`;
        celebrate({ title: "Position closed", body });
        pushToast({ kind: "success", title: "Position closed", body });
      } catch (e) {
        pushToast({
          kind: "error",
          title: "Close failed",
          body: e instanceof Error ? e.message : undefined,
        });
      }
    },
    [address, chainId, signTypedDataAsync, place, pushToast, celebrate]
  );
}
