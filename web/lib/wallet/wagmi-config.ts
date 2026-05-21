"use client";
import { http, createConfig, cookieStorage, createStorage } from "wagmi";
import { mainnet, arbitrum, arbitrumSepolia } from "wagmi/chains";
import { defineChain } from "viem";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";

export const localAnvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "perplex-dev-placeholder";
const isBrowser = typeof window !== "undefined";

export function buildWagmiConfig() {
  const connectors = [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: "Perplex" }),
  ];
  // WalletConnect's storage adapter requires `indexedDB`, which only exists in
  // the browser. Including it on the server triggers an unhandledRejection
  // during RSC prerender even though the consumer is a client component.
  if (isBrowser) {
    connectors.push(
      walletConnect({
        projectId: WC_PROJECT_ID,
        showQrModal: true,
        metadata: {
          name: "Perplex",
          description: "Decentralised perpetual futures",
          url: window.location.origin,
          icons: [],
        },
      })
    );
  }

  return createConfig({
    chains: [mainnet, arbitrum, arbitrumSepolia, localAnvil],
    ssr: true,
    multiInjectedProviderDiscovery: true,
    storage: createStorage({ storage: cookieStorage }),
    connectors,
    transports: {
      [mainnet.id]: http(),
      [arbitrum.id]: http(),
      [arbitrumSepolia.id]: http(),
      [localAnvil.id]: http(),
    },
  });
}

export type AppChainId = 1 | 42161 | 421614 | 31337;
