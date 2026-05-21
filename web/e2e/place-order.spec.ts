import { ANVIL_ACCOUNT_0, ANVIL_KEY_0, ANVIL_RPC, expect, test } from "./fixtures";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseUnits,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ADDR = {
  positionRegistry: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  usdc: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  collateralVault: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
} as const;

const positionRegistryAbi = [
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "size", type: "int256" },
          { name: "entryPriceX18", type: "uint256" },
          { name: "cumulativeFunding", type: "int256" },
          { name: "lastUpdatedBlock", type: "uint64" },
        ],
      },
    ],
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const BTC_MARKET_ID = keccak256(toBytes("btc-usd"));
void encodeAbiParameters;

const publicClient = createPublicClient({ transport: http(ANVIL_RPC) });

test("trader can deposit USDC and place a limit order that updates PositionRegistry", async ({ page }) => {
  // 1. Mint MockUSDC straight to the test account so the deposit form has
  //    something to spend. MockUSDC.mint(to, amount) is unrestricted in dev.
  const account = privateKeyToAccount(ANVIL_KEY_0);
  const walletClient = createWalletClient({ account, transport: http(ANVIL_RPC) });
  const mintAmount = parseUnits("5000", 6);
  await walletClient.writeContract({
    abi: erc20Abi,
    address: ADDR.usdc,
    functionName: "mint",
    args: [ANVIL_ACCOUNT_0, mintAmount],
    chain: null,
  });

  // 2. Boot the wallet page, deposit 1000 USDC, wait for the receipt toast.
  await page.goto("/wallet");
  // The injected wallet should be auto-connected as soon as wagmi probes it.
  // Click the wallet button → injected entry so we're definitely authed.
  await page.getByRole("button", { name: /connect wallet|connecting/i }).first().click();
  await page.getByRole("button", { name: /injected|metamask|perplex e2e/i }).first().click();
  await expect(page.getByText(/sign in \(siwe\)/i)).toBeVisible({ timeout: 30_000 });
  // Auto-SIWE fires on connect; if there's still a manual button, click it.
  const siweButton = page.getByRole("button", { name: /sign in \(siwe\)/i });
  if (await siweButton.isVisible().catch(() => false)) {
    await siweButton.click();
  }

  await page.getByRole("button", { name: /^Deposit$/ }).click();
  await page.getByLabel(/amount/i).fill("1000");
  // First click triggers approve; second triggers deposit.
  await page.getByRole("button", { name: /approve usdc/i }).click();
  await expect(page.getByText(/approval submitted/i)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /deposit usdc/i }).click();
  await expect(page.getByText(/deposit confirmed/i)).toBeVisible({ timeout: 45_000 });

  // 3. Navigate to the trade screen and place a limit order that should
  //    cross the maker side seeded by `scripts/seed.ts`.
  await page.goto("/trade/btc-usd");
  await page.getByRole("button", { name: /^Limit$/ }).click();
  await page.getByLabel(/size/i).fill("0.01");
  // A buy at $200k will sweep the resting asks placed by the seed script.
  await page.getByLabel(/price/i).fill("200000");
  await page.getByRole("button", { name: /long btc/i }).click();
  await expect(page.getByText(/filled|order placed/i)).toBeVisible({ timeout: 30_000 });

  // 4. Direct RPC read against PositionRegistry — this proves the order
  //    actually settled on-chain rather than just hitting the API.
  await expect
    .poll(
      async () => {
        const pos = await publicClient.readContract({
          abi: positionRegistryAbi,
          address: ADDR.positionRegistry,
          functionName: "positions",
          args: [ANVIL_ACCOUNT_0, BTC_MARKET_ID],
        });
        return pos.size;
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .not.toEqual(0n);
});
