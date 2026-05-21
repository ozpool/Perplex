import { test as base, expect, Page } from "@playwright/test";

/**
 * Anvil's first dev account. Same key the contracts/script + smoke scripts
 * use. Public address is `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.
 */
export const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
export const ANVIL_ACCOUNT_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
export const ANVIL_RPC = "http://127.0.0.1:8545";
export const ANVIL_CHAIN_ID = 31337;

/**
 * Inject a minimal EIP-1193 provider into `window.ethereum` BEFORE the page
 * scripts run. The shim signs locally with the anvil dev key and forwards
 * RPC reads/sends to anvil. wagmi's `injected` connector picks it up like
 * any browser wallet.
 */
export async function installInjectedWallet(page: Page) {
  await page.addInitScript(
    ({ key, addr, rpc, chainId }) => {
      // Lazy-load viem inside the page (the FE already bundles it) and build
      // a transport pointed at anvil. The provider is wired up the first
      // time a method is called.
      const accounts = [addr.toLowerCase()];
      const chainIdHex = "0x" + chainId.toString(16);

      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      function emit(event: string, ...args: unknown[]) {
        for (const fn of listeners[event] ?? []) fn(...args);
      }

      type ViemMod = typeof import("viem");
      type Accounts = typeof import("viem/accounts");
      let viemPromise: Promise<{ v: ViemMod; a: Accounts }> | null = null;
      function loadViem() {
        if (!viemPromise) {
          viemPromise = Promise.all([
            import("viem"),
            import("viem/accounts"),
          ]).then(([v, a]) => ({ v, a }));
        }
        return viemPromise;
      }

      const provider = {
        isMetaMask: true,
        chainId: chainIdHex,
        async request({ method, params }: { method: string; params?: unknown[] }) {
          const { v, a } = await loadViem();
          const account = a.privateKeyToAccount(key as `0x${string}`);
          const transport = v.http(rpc);
          const publicClient = v.createPublicClient({ transport });
          const walletClient = v.createWalletClient({ account, transport });

          switch (method) {
            case "eth_chainId":
              return chainIdHex;
            case "eth_accounts":
            case "eth_requestAccounts":
              return accounts;
            case "wallet_switchEthereumChain":
            case "wallet_addEthereumChain":
              return null;
            case "personal_sign": {
              const [message] = params as [`0x${string}`, string];
              return walletClient.signMessage({ message: { raw: message } });
            }
            case "eth_signTypedData_v4": {
              const [, json] = params as [string, string];
              const data = JSON.parse(json);
              return walletClient.signTypedData({
                domain: data.domain,
                types: data.types,
                primaryType: data.primaryType,
                message: data.message,
              });
            }
            case "eth_sendTransaction": {
              const [tx] = params as [Record<string, unknown>];
              return walletClient.sendTransaction({
                // viem's union type is restrictive — the runtime accepts the
                // raw RPC shape verbatim so we cast through `never`.
                ...(tx as Record<string, never>),
                account,
                chain: null,
              });
            }
            default:
              // Forward read-only RPCs straight to anvil.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return (publicClient as any).request({ method, params } as never);
          }
        },
        on(event: string, fn: (...args: unknown[]) => void) {
          (listeners[event] ??= []).push(fn);
        },
        removeListener(event: string, fn: (...args: unknown[]) => void) {
          listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
        },
      };

      Object.defineProperty(window, "ethereum", { value: provider, writable: false });
      // wagmi v2 discovers injected wallets via EIP-6963 announcements too.
      window.addEventListener("eip6963:requestProvider", () => {
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: { uuid: "perplex-e2e", name: "Perplex E2E Wallet", icon: "", rdns: "io.perplex.e2e" },
              provider,
            },
          }),
        );
      });
      // Sanity hook so tests can wait until injection has happened.
      (window as unknown as { __perplexE2E: boolean }).__perplexE2E = true;
      void emit;
    },
    { key: ANVIL_KEY_0, addr: ANVIL_ACCOUNT_0, rpc: ANVIL_RPC, chainId: ANVIL_CHAIN_ID },
  );
}

export const test = base.extend<{ wallet: void }>({
  wallet: [
    async ({ page }, use) => {
      await installInjectedWallet(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
