"use client";
import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { startMockWsServer } from "./ws-mock";

let started = false;

export async function startMocks(): Promise<void> {
  if (started) return;
  try {
    startMockWsServer();
  } catch (e) {
    console.error("[perplex] mock-socket boot failed", e);
  }
  const worker = setupWorker(...handlers);
  await worker.start({
    onUnhandledRequest: "bypass",
    serviceWorker: { url: "/mockServiceWorker.js" },
    quiet: true,
  });
  started = true;
  console.info("[perplex] mock backend ready");
}
