import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./rest";
import type { MarketId, OrderRequest } from "@/lib/types/contract";

export const qk = {
  markets: ["markets"] as const,
  orderbook: (m: MarketId) => ["orderbook", m] as const,
  trades: (m: MarketId) => ["trades", m] as const,
  funding: (m: MarketId) => ["funding", m] as const,
  openOrders: ["openOrders"] as const,
  positions: ["positions"] as const,
  fills: (m?: MarketId) => ["fills", m ?? "all"] as const,
  balance: ["balance"] as const,
};

export function useMarkets() {
  return useQuery({ queryKey: qk.markets, queryFn: api.markets, staleTime: 30_000 });
}

export function useOrderbookSnapshot(marketId: MarketId, enabled = true) {
  return useQuery({
    queryKey: qk.orderbook(marketId),
    queryFn: () => api.orderbook(marketId, 50),
    enabled,
    staleTime: 1_000,
  });
}

export function useRecentTrades(marketId: MarketId) {
  return useQuery({
    queryKey: qk.trades(marketId),
    queryFn: () => api.trades(marketId, 50),
    staleTime: 2_000,
  });
}

export function useFunding(marketId: MarketId) {
  return useQuery({
    queryKey: qk.funding(marketId),
    queryFn: () => api.funding(marketId, "24h"),
    staleTime: 10_000,
  });
}

export function useOpenOrders() {
  return useQuery({ queryKey: qk.openOrders, queryFn: api.openOrders, staleTime: 1_000 });
}

export function usePositions() {
  return useQuery({ queryKey: qk.positions, queryFn: api.positions, staleTime: 1_000 });
}

export function useFills(marketId?: MarketId) {
  return useQuery({ queryKey: qk.fills(marketId), queryFn: () => api.fills({ marketId, limit: 100 }) });
}

export function useBalance() {
  return useQuery({ queryKey: qk.balance, queryFn: api.balance, staleTime: 5_000 });
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: OrderRequest) => api.placeOrder(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.openOrders });
      qc.invalidateQueries({ queryKey: qk.positions });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => api.cancelOrder(orderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.openOrders }),
  });
}
