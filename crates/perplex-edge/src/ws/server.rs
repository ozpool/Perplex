//! tokio-tungstenite-based WebSocket server.
//!
//! Wire protocol (per api-contract.md section 2):
//!   subscribe   -> `{"op":"subscribe","channel":"orderbook.btc-usd"}`
//!   unsubscribe -> `{"op":"unsubscribe","channel":"..."}`
//!   auth        -> `{"op":"auth","token":"<jwt>"}`
//!   pong        -> `{"op":"pong"}`
//!   server ping -> `{"type":"ping","tsNs":"..."}` every 15s
//!
//! Connections that miss a pong for 30s are dropped.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio::time::{interval, Instant};
use tokio_tungstenite::tungstenite::Message as WsMsg;
use tracing::{debug, info, warn};

use crate::auth::verify_jwt;
use crate::state::AppState;
use crate::ws::hub::{Hub, Topic};

pub const HEARTBEAT_EVERY: Duration = Duration::from_secs(15);
pub const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct WsConfig {
    pub bind: SocketAddr,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum ClientMsg {
    Subscribe { channel: String },
    Unsubscribe { channel: String },
    Auth { token: String },
    Pong,
}

#[derive(Debug, Serialize)]
struct ServerPing {
    #[serde(rename = "type")]
    ty: &'static str,
    #[serde(rename = "tsNs")]
    ts_ns: String,
}

pub async fn serve_ws(
    state: AppState,
    hub: Hub,
    cfg: WsConfig,
) -> anyhow::Result<tokio::task::JoinHandle<()>> {
    let listener = TcpListener::bind(cfg.bind).await?;
    info!(addr = %cfg.bind, "ws listening");
    let handle = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, peer)) => {
                    let state = state.clone();
                    let hub = hub.clone();
                    tokio::spawn(handle_connection(stream, peer, state, hub));
                }
                Err(e) => {
                    warn!(?e, "ws accept error");
                }
            }
        }
    });
    Ok(handle)
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    peer: SocketAddr,
    state: AppState,
    hub: Hub,
) {
    let ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(s) => s,
        Err(e) => {
            debug!(%peer, ?e, "ws handshake failed");
            return;
        }
    };
    let (mut sink, mut stream) = ws.split();

    let address: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let subscriptions: Arc<Mutex<HashMap<Topic, u64>>> = Arc::new(Mutex::new(HashMap::new()));
    let last_pong: Arc<Mutex<Instant>> = Arc::new(Mutex::new(Instant::now()));

    // Outgoing fanout: each subscription stuffs into a single shared outgoing channel which the
    // sender task drains. This avoids holding a SplitSink across two tasks.
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<WsMsg>(2048);

    // Heartbeat ticker.
    let last_pong_hb = last_pong.clone();
    let out_tx_hb = out_tx.clone();
    let hb = tokio::spawn(async move {
        let mut tick = interval(HEARTBEAT_EVERY);
        tick.tick().await; // skip immediate first tick
        loop {
            tick.tick().await;
            if last_pong_hb.lock().await.elapsed() > HEARTBEAT_TIMEOUT {
                let _ = out_tx_hb.send(WsMsg::Close(None)).await;
                return;
            }
            let ping = ServerPing {
                ty: "ping",
                ts_ns: crate::state::now_ns().to_string(),
            };
            if out_tx_hb
                .send(WsMsg::Text(serde_json::to_string(&ping).unwrap()))
                .await
                .is_err()
            {
                return;
            }
        }
    });

    // Sender task drains out_rx and writes to the socket.
    let sender = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if sink.send(msg).await.is_err() {
                return;
            }
        }
    });

    // Receiver loop: ingest client ops and route subscriptions through the hub.
    while let Some(frame) = stream.next().await {
        let frame = match frame {
            Ok(f) => f,
            Err(e) => {
                debug!(%peer, ?e, "ws recv error");
                break;
            }
        };
        match frame {
            WsMsg::Text(text) => {
                let parsed: Result<ClientMsg, _> = serde_json::from_str(&text);
                match parsed {
                    Ok(ClientMsg::Subscribe { channel }) => {
                        let topic = match Topic::parse(&channel) {
                            Some(t) => t,
                            None => {
                                let _ = out_tx.send(ack_err(&out_tx, "unknown channel")).await;
                                continue;
                            }
                        };
                        if topic.requires_auth() {
                            let addr = address.lock().await.clone();
                            match addr {
                                Some(a) => {
                                    let bound = topic.with_user(&a);
                                    subscribe_topic(&hub, &out_tx, bound, &subscriptions).await;
                                }
                                None => {
                                    let _ = out_tx.send(ack_err(&out_tx, "auth required")).await;
                                }
                            }
                        } else {
                            subscribe_topic(&hub, &out_tx, topic, &subscriptions).await;
                        }
                    }
                    Ok(ClientMsg::Unsubscribe { channel }) => {
                        if let Some(topic) = Topic::parse(&channel) {
                            let topic = if topic.requires_auth() {
                                let addr = address.lock().await.clone().unwrap_or_default();
                                topic.with_user(&addr)
                            } else {
                                topic
                            };
                            let mut subs = subscriptions.lock().await;
                            if let Some(id) = subs.remove(&topic) {
                                hub.unsubscribe(&topic, id);
                            }
                        }
                    }
                    Ok(ClientMsg::Auth { token }) => match verify_jwt(state.jwt_secret(), &token) {
                        Ok(claims) => {
                            *address.lock().await = Some(claims.sub);
                            let _ = out_tx
                                .send(WsMsg::Text(
                                    serde_json::json!({"type": "auth", "status": "ok"}).to_string(),
                                ))
                                .await;
                        }
                        Err(_) => {
                            let _ = out_tx.send(ack_err(&out_tx, "invalid token")).await;
                        }
                    },
                    Ok(ClientMsg::Pong) => {
                        *last_pong.lock().await = Instant::now();
                    }
                    Err(_) => {
                        let _ = out_tx.send(ack_err(&out_tx, "bad json")).await;
                    }
                }
            }
            WsMsg::Ping(p) => {
                let _ = out_tx.send(WsMsg::Pong(p)).await;
            }
            WsMsg::Pong(_) => {
                *last_pong.lock().await = Instant::now();
            }
            WsMsg::Close(_) => break,
            _ => {}
        }
    }

    // Unsubscribe everything when the connection drops.
    let subs = subscriptions.lock().await;
    for (topic, id) in subs.iter() {
        hub.unsubscribe(topic, *id);
    }
    hb.abort();
    sender.abort();
}

async fn subscribe_topic(
    hub: &Hub,
    out_tx: &tokio::sync::mpsc::Sender<WsMsg>,
    topic: Topic,
    subs: &Arc<Mutex<HashMap<Topic, u64>>>,
) {
    let (id, mut rx) = hub.subscribe(topic.clone());
    subs.lock().await.insert(topic.clone(), id);
    let out_tx = out_tx.clone();
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            // The publisher sets a `type` field on the payload; we just forward.
            if out_tx
                .send(WsMsg::Text(msg.payload.to_string()))
                .await
                .is_err()
            {
                return;
            }
        }
    });
}

fn ack_err(_out_tx: &tokio::sync::mpsc::Sender<WsMsg>, message: &str) -> WsMsg {
    WsMsg::Text(serde_json::json!({"type": "error", "message": message}).to_string())
}
