import { TopNav } from "@/components/layout/TopNav";
import { MobileTabBar } from "@/components/layout/MobileTabBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Lock the entire app shell to viewport height so the trade screen's
  // grid does not push body height beyond the viewport (was causing the
  // chart to overflow below the visible area).
  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <TopNav />
      <main className="flex-1 flex flex-col min-h-0 pb-[var(--mobile-tab-h)] md:pb-0 overflow-y-auto">
        {children}
      </main>
      <MobileTabBar />
    </div>
  );
}
