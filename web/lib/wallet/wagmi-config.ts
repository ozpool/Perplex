"use client";
import { http, createConfig, cookieStorage, createStorage } from "wagmi";
import { arbitrum, arbitrumSepolia } from "wagmi/chains";
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

/**
 * Anvil is exposed only outside production so a deployed prod build cannot
 * accidentally talk to a developer's local fork. Dev profile = NODE_ENV !== "production".
 */
export const IS_DEV_PROFILE = process.env.NODE_ENV !== "production";

const PROD_CHAINS = [arbitrum, arbitrumSepolia] as const;
// Dev profile keeps Anvil first so chain-keyed UI selectors (wallet pill label,
// default-market filter) resolve to the local devnet rather than Arbitrum One
// when the user is actually connected to Anvil. See #88.
const DEV_CHAINS = [localAnvil, arbitrumSepolia, arbitrum] as const;

export const APP_CHAINS = (IS_DEV_PROFILE ? DEV_CHAINS : PROD_CHAINS) as readonly [
  (typeof DEV_CHAINS)[number],
  ...(typeof DEV_CHAINS)[number][],
];

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

  const transports: Record<number, ReturnType<typeof http>> = {
    [arbitrum.id]: http(),
    [arbitrumSepolia.id]: http(),
  };
  if (IS_DEV_PROFILE) {
    transports[localAnvil.id] = http();
  }

  return createConfig({
    chains: APP_CHAINS,
    ssr: true,
    multiInjectedProviderDiscovery: true,
    storage: createStorage({ storage: cookieStorage }),
    connectors,
    transports,
  });
}

export type AppChainId = 42161 | 421614 | 31337;
