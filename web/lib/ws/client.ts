import type { WsMessage, WsOutbound } from "@/lib/types/contract";

type Listener = (msg: WsMessage) => void;

interface PerplexWsOpts {
  url?: string;
  token?: string | null;
  maxReconnectDelayMs?: number;
}

export class PerplexWs {
  private ws: WebSocket | null = null;
  private subs = new Set<string>();
  private listeners = new Set<Listener>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private outboundQueue: WsOutbound[] = [];

  constructor(private opts: PerplexWsOpts = {}) {}

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const url = this.opts.url ?? process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8081";
    const full = this.opts.token ? `${url}?token=${encodeURIComponent(this.opts.token)}` : url;

    let socket: WebSocket;
    try {
      socket = new WebSocket(full);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      for (const ch of this.subs) socket.send(JSON.stringify({ op: "subscribe", channel: ch }));
      while (this.outboundQueue.length) {
        const m = this.outboundQueue.shift();
        if (m) socket.send(JSON.stringify(m));
      }
    };

    socket.onmessage = (ev) => {
      let parsed: WsMessage | { type: "ping"; tsNs: string };
      try {
        parsed = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if ((parsed as { type: string }).type === "ping") {
        try {
          socket.send(JSON.stringify({ op: "pong" }));
        } catch {
          // ignore
        }
        return;
      }
      for (const fn of this.listeners) fn(parsed as WsMessage);
    };

    socket.onclose = () => {
      this.ws = null;
      if (!this.closed) this.scheduleReconnect();
    };

    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        // ignore
      }
    };
  }

  private scheduleReconnect() {
    if (this.closed) return;
    if (this.reconnectTimer) return;
    const max = this.opts.maxReconnectDelayMs ?? 10_000;
    const delay = Math.min(max, 250 * 2 ** this.reconnectAttempt) + Math.random() * 250;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  subscribe(channel: string) {
    if (this.subs.has(channel)) return;
    this.subs.add(channel);
    this.send({ op: "subscribe", channel });
  }

  unsubscribe(channel: string) {
    if (!this.subs.has(channel)) return;
    this.subs.delete(channel);
    this.send({ op: "unsubscribe", channel });
  }

  send(msg: WsOutbound) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.outboundQueue.push(msg);
    }
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setToken(token: string | null) {
    this.opts.token = token;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}

let singleton: PerplexWs | null = null;

export function getWsClient(): PerplexWs {
  if (typeof window === "undefined") {
    throw new Error("PerplexWs is browser-only");
  }
  if (!singleton) {
    const token = window.localStorage.getItem("perplex.jwt");
    singleton = new PerplexWs({ token });
    singleton.connect();
  }
  return singleton;
}
