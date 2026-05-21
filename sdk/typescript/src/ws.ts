// Typed WebSocket wrapper matching api-contract.md section 2. Auto-reconnects with
// exponential backoff, handles the 15s ping/pong heartbeat the server requires, and
// dispatches by parsed `type` field.

export type WsChannelMessage = {
  type: string;
  channel?: string;
  [k: string]: unknown;
};

export type WsListener = (msg: WsChannelMessage) => void;

export interface PerplexWsConfig {
  url: string; // e.g. "ws://localhost:8081"
  jwt?: string;
  reconnect?: boolean;
  // Polyfill point for Node (use `ws` library) — defaults to the global WebSocket in browsers.
  wsImpl?: typeof WebSocket;
}

interface Subscription {
  channel: string;
  listeners: Set<WsListener>;
}

export class PerplexWs {
  private ws: WebSocket | null = null;
  private readonly subs = new Map<string, Subscription>();
  private jwt: string | undefined;
  private readonly url: string;
  private readonly reconnect: boolean;
  private readonly WsCtor: typeof WebSocket;
  private backoffMs = 500;
  private destroyed = false;
  private authPromise: Promise<void> | null = null;

  constructor(cfg: PerplexWsConfig) {
    this.url = cfg.url;
    this.jwt = cfg.jwt;
    this.reconnect = cfg.reconnect ?? true;
    const ctor = cfg.wsImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!ctor) {
      throw new Error("no WebSocket implementation found; pass wsImpl from `ws` on Node");
    }
    this.WsCtor = ctor;
  }

  setJwt(jwt: string | undefined) {
    this.jwt = jwt;
  }

  connect(): void {
    if (this.ws) return;
    this.destroyed = false;
    const ws = new this.WsCtor(this.url);
    this.ws = ws;
    ws.addEventListener("open", () => this.onOpen());
    ws.addEventListener("message", (ev) => this.onMessage(ev));
    ws.addEventListener("close", () => this.onClose());
    ws.addEventListener("error", () => {
      // browser surfaces error before close; let close drive the reconnect.
    });
  }

  close(): void {
    this.destroyed = true;
    this.subs.clear();
    this.ws?.close();
    this.ws = null;
  }

  subscribe(channel: string, listener: WsListener): () => void {
    let sub = this.subs.get(channel);
    if (!sub) {
      sub = { channel, listeners: new Set() };
      this.subs.set(channel, sub);
      this.send({ op: "subscribe", channel });
    }
    sub.listeners.add(listener);
    return () => this.unsubscribe(channel, listener);
  }

  unsubscribe(channel: string, listener: WsListener): void {
    const sub = this.subs.get(channel);
    if (!sub) return;
    sub.listeners.delete(listener);
    if (sub.listeners.size === 0) {
      this.subs.delete(channel);
      this.send({ op: "unsubscribe", channel });
    }
  }

  /// Sends auth then awaits the server ack. Resolves on first {type:"auth"} after send.
  async authenticate(jwt: string): Promise<void> {
    this.jwt = jwt;
    if (!this.ws || this.ws.readyState !== this.WsCtor.OPEN) {
      this.connect();
      await this.waitForOpen();
    }
    if (this.authPromise) return this.authPromise;
    this.authPromise = new Promise<void>((resolve, reject) => {
      const onMsg = (ev: MessageEvent) => {
        const parsed = parseFrame(ev.data);
        if (!parsed) return;
        if (parsed.type === "auth") {
          this.ws?.removeEventListener("message", onMsg);
          this.authPromise = null;
          resolve();
        } else if (parsed.type === "error") {
          this.ws?.removeEventListener("message", onMsg);
          this.authPromise = null;
          reject(new Error(String(parsed.message ?? "auth failed")));
        }
      };
      this.ws?.addEventListener("message", onMsg);
      this.send({ op: "auth", token: jwt });
    });
    return this.authPromise;
  }

  private waitForOpen(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws && this.ws.readyState === this.WsCtor.OPEN) return resolve();
      const onOpen = () => {
        this.ws?.removeEventListener("open", onOpen);
        resolve();
      };
      this.ws?.addEventListener("open", onOpen);
    });
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === this.WsCtor.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private onOpen(): void {
    this.backoffMs = 500;
    // Re-subscribe to all topics + re-auth on reconnect.
    if (this.jwt) {
      this.send({ op: "auth", token: this.jwt });
    }
    for (const channel of this.subs.keys()) {
      this.send({ op: "subscribe", channel });
    }
  }

  private onMessage(ev: MessageEvent): void {
    const parsed = parseFrame(ev.data);
    if (!parsed) return;
    if (parsed.type === "ping") {
      this.send({ op: "pong" });
      return;
    }
    if (typeof parsed.channel === "string") {
      const sub = this.subs.get(parsed.channel);
      if (sub) {
        for (const l of sub.listeners) l(parsed);
      }
    }
  }

  private onClose(): void {
    this.ws = null;
    if (this.destroyed || !this.reconnect) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 10_000);
    setTimeout(() => this.connect(), delay);
  }
}

function parseFrame(raw: unknown): WsChannelMessage | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as WsChannelMessage;
  } catch {
    return null;
  }
}
