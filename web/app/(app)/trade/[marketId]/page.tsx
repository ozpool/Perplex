import { notFound } from "next/navigation";
import { TradeLayout } from "@/components/trade/TradeLayout";
import type { MarketId } from "@/lib/types/contract";

const VALID: MarketId[] = ["btc-usd", "eth-usd", "sol-usd"];

interface Params {
  params: Promise<{ marketId: string }>;
}

export default async function TradePage({ params }: Params) {
  const { marketId } = await params;
  if (!VALID.includes(marketId as MarketId)) notFound();
  return <TradeLayout marketId={marketId as MarketId} />;
}

export async function generateStaticParams() {
  return VALID.map((id) => ({ marketId: id }));
}
