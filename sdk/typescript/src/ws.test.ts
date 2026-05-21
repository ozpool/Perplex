// Unit tests for the WebSocket wrapper. We stub a minimal in-memory WebSocket constructor so
// the tests run with no network or `ws` dependency.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { PerplexWs } from "./ws.ts";

type Listener = (ev: any) => void;

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING as number;
  sent: string[] = [];
  url: string;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatch("open", {});
    });
  }

  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", {});
  }
  emit(data: string) {
    this.dispatch("message", { data });
  }
  private dispatch(type: string, ev: any) {
    for (const l of this.listeners.get(type) ?? []) l(ev);
  }
}

describe("PerplexWs", () => {
  it("sends a subscribe frame on subscribe and routes messages to listeners", async () => {
    FakeWebSocket.instances = [];
    const ws = new PerplexWs({ url: "ws://x", wsImpl: FakeWebSocket as unknown as typeof WebSocket });
    ws.connect();
    await new Promise((r) => setTimeout(r, 5));
    const sock = FakeWebSocket.instances[0]!;
    const received: any[] = [];
    ws.subscribe("trades.btc-usd", (m) => received.push(m));
    assert.deepEqual(JSON.parse(sock.sent[0]!), { op: "subscribe", channel: "trades.btc-usd" });
    sock.emit(JSON.stringify({ type: "trade", channel: "trades.btc-usd", price: "1" }));
    assert.equal(received.length, 1);
    assert.equal(received[0].price, "1");
  });

  it("replies to server ping with pong", async () => {
    FakeWebSocket.instances = [];
    const ws = new PerplexWs({ url: "ws://x", wsImpl: FakeWebSocket as unknown as typeof WebSocket });
    ws.connect();
    await new Promise((r) => setTimeout(r, 5));
    const sock = FakeWebSocket.instances[0]!;
    sock.emit(JSON.stringify({ type: "ping", tsNs: "1" }));
    assert.deepEqual(JSON.parse(sock.sent.at(-1)!), { op: "pong" });
  });

  it("unsubscribe sends frame when the last listener detaches", async () => {
    FakeWebSocket.instances = [];
    const ws = new PerplexWs({ url: "ws://x", wsImpl: FakeWebSocket as unknown as typeof WebSocket });
    ws.connect();
    await new Promise((r) => setTimeout(r, 5));
    const sock = FakeWebSocket.instances[0]!;
    const a = () => {};
    const b = () => {};
    const offA = ws.subscribe("trades.eth-usd", a);
    ws.subscribe("trades.eth-usd", b);
    offA();
    // First listener remains — no unsubscribe yet.
    assert.equal(sock.sent.filter((x) => x.includes("unsubscribe")).length, 0);
    ws.unsubscribe("trades.eth-usd", b);
    // Both gone — server unsubscribe is sent.
    assert.equal(sock.sent.filter((x) => x.includes("unsubscribe")).length, 1);
  });

  it("auto-resubscribes on reconnect", async () => {
    FakeWebSocket.instances = [];
    const ws = new PerplexWs({
      url: "ws://x",
      wsImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    ws.connect();
    await new Promise((r) => setTimeout(r, 5));
    const sock = FakeWebSocket.instances[0]!;
    ws.subscribe("trades.btc-usd", () => {});
    assert.equal(sock.sent.length, 1);
    // Close → triggers reconnect after backoff.
    sock.close();
    await new Promise((r) => setTimeout(r, 700));
    const sock2 = FakeWebSocket.instances[1]!;
    // The new socket received a subscribe frame replaying the existing topics.
    assert.equal(sock2.sent.length, 1);
    assert.deepEqual(JSON.parse(sock2.sent[0]!), {
      op: "subscribe",
      channel: "trades.btc-usd",
    });
    ws.close();
  });
});
