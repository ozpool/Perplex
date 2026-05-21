"use client";
import { create } from "zustand";
import type { MarketId, OpenOrder } from "@/lib/types/contract";

export type Toast = {
  id: string;
  kind: "info" | "success" | "warn" | "error";
  title: string;
  body?: string;
};

export type OptimisticOrder = OpenOrder & { optimistic: true; clientOrderId: string };

interface UiState {
  selectedMarket: MarketId;
  setSelectedMarket: (m: MarketId) => void;

  walletDrawerOpen: boolean;
  openWalletDrawer: () => void;
  closeWalletDrawer: () => void;

  optimisticOrders: OptimisticOrder[];
  addOptimisticOrder: (o: OptimisticOrder) => void;
  removeOptimisticOrder: (clientOrderId: string) => void;

  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
}

export const useUi = create<UiState>((set) => ({
  selectedMarket: "btc-usd",
  setSelectedMarket: (m) => set({ selectedMarket: m }),

  walletDrawerOpen: false,
  openWalletDrawer: () => set({ walletDrawerOpen: true }),
  closeWalletDrawer: () => set({ walletDrawerOpen: false }),

  optimisticOrders: [],
  addOptimisticOrder: (o) =>
    set((s) => ({ optimisticOrders: [o, ...s.optimisticOrders.filter((x) => x.clientOrderId !== o.clientOrderId)] })),
  removeOptimisticOrder: (cid) =>
    set((s) => ({ optimisticOrders: s.optimisticOrders.filter((x) => x.clientOrderId !== cid) })),

  toasts: [],
  pushToast: (t) =>
    set((s) => {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      return { toasts: [...s.toasts, { ...t, id }] };
    }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
