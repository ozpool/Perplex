"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useMarkets, usePositions } from "@/lib/api/queries";
import type { MarketId } from "@/lib/types/contract";
import { useUi } from "@/lib/store/ui-store";
import { MarketHeader } from "./MarketHeader";
import { Orderbook } from "./Orderbook";
import { TradeTape } from "./TradeTape";
import { OrderForm } from "./OrderForm";
import { PositionPanel } from "./PositionPanel";
import { Tabs } from "@/components/ui/Tabs";

const PriceChart = dynamic(() => import("@/components/chart/PriceChart").then((m) => m.PriceChart), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid-dots" />,
});

interface Props {
  marketId: MarketId;
}

type MobileTab = "chart" | "book" | "form" | "position";

export function TradeLayout({ marketId }: Props) {
  const setMarket = useUi((s) => s.setSelectedMarket);
  useEffect(() => {
    setMarket(marketId);
  }, [marketId, setMarket]);

  const { data: marketsData } = useMarkets();
  const market = useMemo(() => marketsData?.markets.find((m) => m.id === marketId), [marketsData, marketId]);
  const anchor = market ? Number(market.indexPriceX18) : marketId === "btc-usd" ? 100000 : marketId === "eth-usd" ? 3500 : 200;

  const { data: positions } = usePositions();
  const freeCollateral = positions?.freeCollateralUsdc;

  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");

  return (
    <div className="flex flex-col flex-1 min-h-full">
      <MarketHeader marketId={marketId} market={market} />

      {/* Desktop layout */}
      <div className="hidden md:grid flex-1 min-h-0 grid-rows-[1fr_240px] grid-cols-[minmax(0,1fr)_minmax(260px,300px)_minmax(280px,320px)]">
        <div className="relative border-r border-border row-span-1 col-span-1 overflow-hidden min-h-0">
          <PriceChart marketId={marketId} anchor={anchor} />
        </div>
        <div className="border-r border-border row-span-1 col-span-1 flex flex-col min-h-0">
          <div className="flex-[3] min-h-0 border-b border-border">
            <Orderbook marketId={marketId} market={market} />
          </div>
          <div className="flex-[2] min-h-0">
            <TradeTape marketId={marketId} market={market} />
          </div>
        </div>
        <div className="row-span-2 col-span-1 border-l-0 border-border flex flex-col min-h-0">
          <OrderForm marketId={marketId} market={market} freeCollateralUsdc={freeCollateral} />
        </div>
        <div className="col-span-2 row-span-1 border-t border-border min-h-0">
          <PositionPanel marketId={marketId} />
        </div>
      </div>

      {/* Mobile layout */}
      <div className="md:hidden flex flex-col flex-1 min-h-0">
        <div className="px-3 pt-2">
          <Tabs<MobileTab>
            variant="segmented"
            value={mobileTab}
            onChange={setMobileTab}
            items={[
              { value: "chart", label: "Chart" },
              { value: "book", label: "Book" },
              { value: "form", label: "Trade" },
              { value: "position", label: "Position" },
            ]}
          />
        </div>
        <div className="flex-1 min-h-0 relative mt-2">
          {mobileTab === "chart" && (
            <div className="absolute inset-0">
              <PriceChart marketId={marketId} anchor={anchor} />
            </div>
          )}
          {mobileTab === "book" && (
            <div className="absolute inset-0 grid grid-rows-2 border-t border-border">
              <div className="border-b border-border min-h-0">
                <Orderbook marketId={marketId} market={market} />
              </div>
              <div className="min-h-0">
                <TradeTape marketId={marketId} market={market} />
              </div>
            </div>
          )}
          {mobileTab === "form" && (
            <div className="absolute inset-0 border-t border-border">
              <OrderForm marketId={marketId} market={market} freeCollateralUsdc={freeCollateral} />
            </div>
          )}
          {mobileTab === "position" && (
            <div className="absolute inset-0 border-t border-border">
              <PositionPanel marketId={marketId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
