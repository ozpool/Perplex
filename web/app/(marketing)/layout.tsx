import { PillNav } from "@/components/spark/PillNav";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="spark min-h-dvh w-full p-3 sm:p-5 lg:p-7">
      <div className="relative w-full min-h-[calc(100dvh-2.5rem)] bg-[var(--s-bg)] rounded-[24px] sm:rounded-[32px] overflow-clip">
        <PillNav />
        {children}
      </div>
    </div>
  );
}
