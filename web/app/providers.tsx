"use client";

import { useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildWagmiConfig } from "@/lib/wallet/wagmi-config";
import { ToastViewport } from "@/components/common/ToastViewport";
import { Logo } from "@/components/layout/Logo";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 2,
        staleTime: 5_000,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [wagmiConfig] = useState(buildWagmiConfig);
  const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "1";
  const [mocksReady, setMocksReady] = useState(!useMocks);
  const [mocksError, setMocksError] = useState<string | null>(null);

  useEffect(() => {
    if (!useMocks) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setMocksError("Mock backend did not start within 10s. Reload the page or check the browser console.");
        setMocksReady(true); // unblock UI so user can see errors instead of stuck splash
      }
    }, 10_000);
    (async () => {
      try {
        const { startMocks } = await import("@/mocks/browser");
        await startMocks();
        if (cancelled) return;
        clearTimeout(timeout);
        setMocksReady(true);
        queryClient.invalidateQueries();
      } catch (e) {
        if (cancelled) return;
        clearTimeout(timeout);
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[perplex] startMocks failed", e);
        setMocksError(msg);
        setMocksReady(true);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [useMocks, queryClient]);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {mocksReady ? children : <BootSplash />}
        {mocksError && <MocksErrorBanner error={mocksError} />}
        <ToastViewport />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function MocksErrorBanner({ error }: { error: string }) {
  return (
    <div
      role="alert"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-[min(560px,calc(100vw-2rem))] px-4 py-3 rounded-[var(--radius-md)] border border-[var(--short-strong)] bg-short-soft shadow-[var(--shadow-elev-2)]"
    >
      <div className="text-sm text-fg font-medium mb-1">Mock backend failed to start</div>
      <div className="text-xs text-fg-muted mb-2 font-mono break-all">{error}</div>
      <button
        onClick={() => window.location.reload()}
        className="text-xs px-3 h-7 rounded-[var(--radius-sm)] bg-bg-2 hover:bg-bg-hover border border-border text-fg"
      >
        Reload page
      </button>
    </div>
  );
}

function BootSplash() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-fg-muted">
      <Logo />
      <div className="flex items-center gap-2 text-[12px]">
        <span className="size-1.5 rounded-full bg-accent pulse-dot" />
        <span>booting mock backend…</span>
      </div>
    </div>
  );
}
