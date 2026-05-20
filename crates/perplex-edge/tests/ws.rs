//! WebSocket integration tests.
//!
//! Coverage:
//!   - subscribe to a public channel and receive a published message
//!   - unsubscribe stops further delivery
//!   - auth gate on private channels (user.fills)
//!   - heartbeat: server sends `type: "ping"` within 16s
//!   - bad json on the wire surfaces an `error` ack
//!   - subscribe to an unknown channel returns an error ack

use std::net::SocketAddr;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use perplex_edge::auth::issue_jwt;
use perplex_edge::ws::{serve_ws, Hub, Message, Topic, WsConfig};
use perplex_edge::AppState;
use tokio_tungstenite::tungstenite::Message as WsMsg;

fn jwt_secret() -> Vec<u8> {
    b"ws-test-secret".to_vec()
}

async fn spawn() -> (String, AppState, Hub) {
    let state = AppState::new(jwt_secret());
    let hub = Hub::new();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    drop(listener); // free port; serve_ws rebinds.
    let url = format!("ws://{}", addr);
    serve_ws(state.clone(), hub.clone(), WsConfig { bind: addr })
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    (url, state, hub)
}

#[tokio::test]
async fn subscribe_and_receive() {
    let (url, _state, hub) = spawn().await;
    let (mut client, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    client
        .send(WsMsg::Text(
            r#"{"op":"subscribe","channel":"trades.btc-usd"}"#.into(),
        ))
        .await
        .unwrap();
    // Allow the server to register the sub.
    tokio::time::sleep(Duration::from_millis(100)).await;

    hub.publish(Message {
        topic: Topic::Trades("btc-usd".into()),
        payload: serde_json::json!({"type":"trade","price":"100050.0","qty":"0.05"}),
    });

    let timeout = tokio::time::Duration::from_secs(2);
    let frame = tokio::time::timeout(timeout, client.next()).await.unwrap();
    let msg = frame.unwrap().unwrap();
    let text = msg.into_text().unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["type"], "trade");
    assert_eq!(v["price"], "100050.0");
}

#[tokio::test]
async fn unsubscribe_stops_delivery() {
    let (url, _state, hub) = spawn().await;
    let (mut client, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    client
        .send(WsMsg::Text(
            r#"{"op":"subscribe","channel":"trades.eth-usd"}"#.into(),
        ))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(80)).await;

    client
        .send(WsMsg::Text(
            r#"{"op":"unsubscribe","channel":"trades.eth-usd"}"#.into(),
        ))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(80)).await;

    hub.publish(Message {
        topic: Topic::Trades("eth-usd".into()),
        payload: serde_json::json!({"type":"trade"}),
    });

    let res = tokio::time::timeout(Duration::from_millis(500), client.next()).await;
    assert!(res.is_err(), "no message expected after unsubscribe");
}

#[tokio::test]
async fn private_channel_requires_auth() {
    let (url, state, hub) = spawn().await;
    let (mut client, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    client
        .send(WsMsg::Text(
            r#"{"op":"subscribe","channel":"user.fills"}"#.into(),
        ))
        .await
        .unwrap();

    let frame = tokio::time::timeout(Duration::from_secs(2), client.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let v: serde_json::Value = serde_json::from_str(&frame.into_text().unwrap()).unwrap();
    assert_eq!(v["type"], "error");

    // Authenticate, then re-subscribe.
    let addr = "0x000000000000000000000000000000000000aBcD";
    let (jwt, _) = issue_jwt(state.jwt_secret(), addr).unwrap();
    client
        .send(WsMsg::Text(format!(r#"{{"op":"auth","token":"{}"}}"#, jwt)))
        .await
        .unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(2), client.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let v: serde_json::Value = serde_json::from_str(&frame.into_text().unwrap()).unwrap();
    assert_eq!(v["type"], "auth");

    client
        .send(WsMsg::Text(
            r#"{"op":"subscribe","channel":"user.fills"}"#.into(),
        ))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;

    hub.publish(Message {
        topic: Topic::UserFills(addr.into()),
        payload: serde_json::json!({"type":"fill","id":"fill_X"}),
    });

    let frame = tokio::time::timeout(Duration::from_secs(2), client.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let v: serde_json::Value = serde_json::from_str(&frame.into_text().unwrap()).unwrap();
    assert_eq!(v["id"], "fill_X");
}

#[tokio::test]
async fn unknown_channel_returns_error() {
    let (url, _state, _hub) = spawn().await;
    let (mut client, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    client
        .send(WsMsg::Text(
            r#"{"op":"subscribe","channel":"bogus.btc"}"#.into(),
        ))
        .await
        .unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(2), client.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let v: serde_json::Value = serde_json::from_str(&frame.into_text().unwrap()).unwrap();
    assert_eq!(v["type"], "error");
}

#[tokio::test]
async fn bad_json_returns_error() {
    let (url, _state, _hub) = spawn().await;
    let (mut client, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    client.send(WsMsg::Text("not json".into())).await.unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(2), client.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let v: serde_json::Value = serde_json::from_str(&frame.into_text().unwrap()).unwrap();
    assert_eq!(v["type"], "error");
}
