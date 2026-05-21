import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PERPLEX_E2E_PORT ?? 3000);
const BASE_URL = process.env.PERPLEX_E2E_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * Playwright E2E for the FE. The runner spawns `next start` against the
 * already-built `.next/` output, so make sure `pnpm web:build` ran first.
 * The web server hits the local edge (`make dev-up`) at :8080 / :8081 and
 * anvil at :8545; tests sign with anvil's well-known dev key.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // contracts state is shared across tests
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    headless: true,
    actionTimeout: 15_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.PERPLEX_E2E_NO_SERVER
      ? "true"
      : `NEXT_PUBLIC_USE_MOCKS=0 NEXT_PUBLIC_API_URL=http://localhost:8080 NEXT_PUBLIC_WS_URL=ws://localhost:8081 pnpm exec next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
