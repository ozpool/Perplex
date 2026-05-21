"use client";
import { useEffect, useRef } from "react";
import type { MarketId } from "@/lib/types/contract";
import { useLiveOracle } from "@/lib/ws/channels";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type Time,
} from "lightweight-charts";

interface Props {
  marketId: MarketId;
  anchor: number;
}

interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

const TF_SECONDS = 60; // 1m candles

function seedCandles(anchor: number, count = 200): { candles: Candle[]; vols: { time: UTCTimestamp; value: number; color: string }[] } {
  const now = Math.floor(Date.now() / 1000);
  const start = now - count * TF_SECONDS;
  const candles: Candle[] = [];
  const vols: { time: UTCTimestamp; value: number; color: string }[] = [];
  let price = anchor;
  for (let i = 0; i < count; i++) {
    const t = (start + i * TF_SECONDS) as UTCTimestamp;
    const drift = (Math.random() - 0.5) * anchor * 0.0025;
    const open = price;
    const close = Math.max(0.0001, open + drift);
    const high = Math.max(open, close) + Math.random() * anchor * 0.0015;
    const low = Math.min(open, close) - Math.random() * anchor * 0.0015;
    candles.push({ time: t, open, high, low, close });
    const up = close >= open;
    vols.push({
      time: t,
      value: Math.random() * anchor * 0.5 + anchor * 0.1,
      color: up ? "rgba(15, 165, 106, 0.45)" : "rgba(214, 48, 68, 0.45)",
    });
    price = close;
  }
  return { candles, vols };
}

export function PriceChart({ marketId, anchor }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const currentCandleRef = useRef<Candle | null>(null);

  const oracle = useLiveOracle(marketId);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#736b8a",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(15, 8, 52, 0.06)" },
        horzLines: { color: "rgba(15, 8, 52, 0.06)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(15, 8, 52, 0.45)", labelBackgroundColor: "#0c0530", width: 1, style: 3 },
        horzLine: { color: "rgba(15, 8, 52, 0.45)", labelBackgroundColor: "#0c0530", width: 1, style: 3 },
      },
      rightPriceScale: { borderColor: "rgba(15, 8, 52, 0.12)", scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: "rgba(15, 8, 52, 0.12)", timeVisible: true, secondsVisible: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) chart.resize(width, height);
    });
    ro.observe(containerRef.current);

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#0fa56a",
      downColor: "#d63044",
      borderUpColor: "#0fa56a",
      borderDownColor: "#d63044",
      wickUpColor: "#0a8a57",
      wickDownColor: "#b32034",
      priceFormat: { type: "price", precision: anchor >= 1000 ? 1 : anchor >= 100 ? 2 : 4, minMove: 0.0001 },
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      color: "#0fa56a",
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const { candles, vols } = seedCandles(anchor, 240);
    candleSeries.setData(candles);
    volSeries.setData(vols);
    currentCandleRef.current = candles[candles.length - 1];

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;

    chart.timeScale().fitContent();

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      currentCandleRef.current = null;
    };
  }, [marketId, anchor]);

  // Apply oracle ticks
  useEffect(() => {
    if (!oracle || !candleSeriesRef.current) return;
    const px = Number(oracle.priceX18);
    if (!Number.isFinite(px)) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const bucketStart = (Math.floor(nowSec / TF_SECONDS) * TF_SECONDS) as UTCTimestamp;

    const current = currentCandleRef.current;
    if (!current || current.time !== bucketStart) {
      // open new candle
      const open = current ? current.close : px;
      const newCandle: Candle = { time: bucketStart, open, high: px, low: px, close: px };
      currentCandleRef.current = newCandle;
      candleSeriesRef.current.update(newCandle);
      volSeriesRef.current?.update({
        time: bucketStart as Time,
        value: Math.random() * 200,
        color: px >= open ? "rgba(15, 165, 106, 0.45)" : "rgba(214, 48, 68, 0.45)",
      });
    } else {
      current.high = Math.max(current.high, px);
      current.low = Math.min(current.low, px);
      current.close = px;
      candleSeriesRef.current.update(current);
    }
  }, [oracle]);

  return <div ref={containerRef} className="absolute inset-0 overflow-hidden" />;
}
