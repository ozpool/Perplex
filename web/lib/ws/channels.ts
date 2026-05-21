import { useEffect, useRef, useState } from "react";
import { getWsClient } from "./client";
import type {
  MarketId,
  OrderbookLevel,
  WsAccountMessage,
  WsFunding,
  WsMessage,
  WsOracle,
  WsOrderbookDelta,
  WsOrderbookSnapshot,
  WsTrade,
} from "@/lib/types/contract";

// Maintain a sorted ladder; map keyed by price string for cheap upserts.
function applyDelta(book: Map<string, string>, levels: OrderbookLevel[]) {
  for (const [price, qty] of levels) {
    if (qty === "0" || Number(qty) === 0) book.delete(price);
    else book.set(price, qty);
  }
}

export interface LiveOrderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  sequence: number;
  tsNs: string;
}

export function useLiveOrderbook(marketId: MarketId): LiveOrderbook | null {
  const [state, setState] = useState<LiveOrderbook | null>(null);
  const bidsRef = useRef<Map<string, string>>(new Map());
  const asksRef = useRef<Map<string, string>>(new Map());
  const seqRef = useRef<number>(0);

  useEffect(() => {
    const ws = getWsClient();
    const channel = `orderbook.${marketId}`;
    bidsRef.current = new Map();
    asksRef.current = new Map();
    seqRef.current = 0;

    // Coalesce setState into one rAF tick so a burst of deltas can't trigger
    // a render per message. Even with a 50-level book the sort+slice is cheap,
    // but React reconciliation + Orderbook's useMemo cost dominates — keeping
    // them on the paint cadence keeps repaints comfortably under the 16ms
    // budget called out in #39.
    let lastTsNs = "0";
    let rafScheduled = false;
    const flush = () => {
      rafScheduled = false;
      const sortedBids = Array.from(bidsRef.current.entries())
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .slice(0, 25) as OrderbookLevel[];
      const sortedAsks = Array.from(asksRef.current.entries())
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .slice(0, 25) as OrderbookLevel[];
      setState({ bids: sortedBids, asks: sortedAsks, sequence: seqRef.current, tsNs: lastTsNs });
    };
    const scheduleFlush = (tsNs: string) => {
      lastTsNs = tsNs;
      if (rafScheduled) return;
      rafScheduled = true;
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(flush);
      } else {
        // SSR / test runners — fall back to a microtask.
        queueMicrotask(flush);
      }
    };

    const off = ws.on((m: WsMessage) => {
      if (!("channel" in m) || m.channel !== channel) return;
      if (m.type === "snapshot") {
        const snap = m as WsOrderbookSnapshot;
        bidsRef.current = new Map(snap.bids);
        asksRef.current = new Map(snap.asks);
        seqRef.current = snap.sequence;
      } else if (m.type === "delta") {
        const d = m as WsOrderbookDelta;
        if (d.sequence !== seqRef.current + 1 && seqRef.current !== 0) {
          ws.unsubscribe(channel);
          ws.subscribe(channel);
          return;
        }
        applyDelta(bidsRef.current, d.bids);
        applyDelta(asksRef.current, d.asks);
        seqRef.current = d.sequence;
      } else {
        return;
      }
      scheduleFlush(m.tsNs);
    });

    ws.subscribe(channel);
    return () => {
      ws.unsubscribe(channel);
      off();
    };
  }, [marketId]);

  return state;
}

export function useLiveTrades(marketId: MarketId, max = 50): WsTrade[] {
  const [trades, setTrades] = useState<WsTrade[]>([]);
  useEffect(() => {
    const ws = getWsClient();
    const channel = `trades.${marketId}`;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTrades([]);
    const off = ws.on((m) => {
      if (m.type === "trade" && m.channel === channel) {
        setTrades((prev) => [m, ...prev].slice(0, max));
      }
    });
    ws.subscribe(channel);
    return () => {
      ws.unsubscribe(channel);
      off();
    };
  }, [marketId, max]);
  return trades;
}

export function useLiveOracle(marketId: MarketId): WsOracle | null {
  const [oracle, setOracle] = useState<WsOracle | null>(null);
  useEffect(() => {
    const ws = getWsClient();
    const channel = `oracle.${marketId}`;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOracle(null);
    const off = ws.on((m) => {
      if (m.type === "oracle" && m.channel === channel) setOracle(m);
    });
    ws.subscribe(channel);
    return () => {
      ws.unsubscribe(channel);
      off();
    };
  }, [marketId]);
  return oracle;
}

export function useLiveFunding(marketId: MarketId): WsFunding | null {
  const [funding, setFunding] = useState<WsFunding | null>(null);
  useEffect(() => {
    const ws = getWsClient();
    const channel = `funding.${marketId}`;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFunding(null);
    const off = ws.on((m) => {
      if (m.type === "funding" && m.channel === channel) setFunding(m);
    });
    ws.subscribe(channel);
    return () => {
      ws.unsubscribe(channel);
      off();
    };
  }, [marketId]);
  return funding;
}

export function useAccountStream(wallet: string | null | undefined, handler: (msg: WsAccountMessage) => void) {
  useEffect(() => {
    if (!wallet) return;
    const ws = getWsClient();
    const channel = `account.${wallet.toLowerCase()}`;
    const off = ws.on((m) => {
      const t = (m as { type: string }).type;
      if (
        t === "order.accepted" ||
        t === "order.cancelled" ||
        t === "order.filled" ||
        t === "position.update" ||
        t === "liquidation.warning" ||
        t === "liquidation.executed" ||
        t === "funding.applied"
      ) {
        handler(m as WsAccountMessage);
      }
    });
    ws.subscribe(channel);
    return () => {
      ws.unsubscribe(channel);
      off();
    };
  }, [wallet, handler]);
}
