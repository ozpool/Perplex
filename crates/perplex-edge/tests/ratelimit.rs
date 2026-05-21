//! Integration tests for the rate-limit middleware.
//!
//! Uses a tiny custom router with the rate-limit layer applied to a stub endpoint so the
//! bucket sizes can be tuned per test without bumping into the production thresholds.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ConnectInfo;
use axum::middleware::from_fn_with_state;
use axum::routing::get;
use axum::Router;
use perplex_edge::ratelimit::{rate_limit_layer, Bucket, InMemoryBucket, Limit, RateLimiter};
use perplex_edge::AppState;
use reqwest::StatusCode;

async fn ok_handler(ConnectInfo(_peer): ConnectInfo<SocketAddr>) -> &'static str {
    "ok"
}

async fn spawn_with_limit(limit: Limit) -> (String, tokio::task::JoinHandle<()>) {
    let state = AppState::new(b"rl-test".to_vec());
    let bucket = Arc::new(InMemoryBucket::new()) as Arc<dyn Bucket>;
    let limiter = RateLimiter {
        bucket,
        public_limit: limit,
        authed_limit: limit,
    };
    let app = Router::new()
        .route("/ping", get(ok_handler))
        .layer(from_fn_with_state(
            (state.clone(), limiter),
            rate_limit_layer,
        ))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    tokio::time::sleep(Duration::from_millis(40)).await;
    (format!("http://127.0.0.1:{port}"), handle)
}

#[tokio::test]
async fn burst_within_capacity_passes() {
    let (base, handle) = spawn_with_limit(Limit {
        capacity: 5,
        refill_per_sec: 1,
    })
    .await;
    let client = reqwest::Client::new();
    for _ in 0..5 {
        let res = client.get(format!("{base}/ping")).send().await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }
    handle.abort();
}

#[tokio::test]
async fn sustained_over_limit_returns_429_with_retry_after() {
    let (base, handle) = spawn_with_limit(Limit {
        capacity: 3,
        refill_per_sec: 1,
    })
    .await;
    let client = reqwest::Client::new();
    for _ in 0..3 {
        let res = client.get(format!("{base}/ping")).send().await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }
    let res = client.get(format!("{base}/ping")).send().await.unwrap();
    assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
    let retry_after = res
        .headers()
        .get("retry-after")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap();
    assert!(retry_after >= 1);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["error"]["code"], "RATE_LIMITED");
    handle.abort();
}

#[tokio::test]
async fn refill_recovers_after_wait() {
    let (base, handle) = spawn_with_limit(Limit {
        capacity: 2,
        refill_per_sec: 100, // fast refill so the test stays under a second
    })
    .await;
    let client = reqwest::Client::new();
    for _ in 0..2 {
        let res = client.get(format!("{base}/ping")).send().await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }
    let denied = client.get(format!("{base}/ping")).send().await.unwrap();
    assert_eq!(denied.status(), StatusCode::TOO_MANY_REQUESTS);

    tokio::time::sleep(Duration::from_millis(50)).await;
    let ok = client.get(format!("{base}/ping")).send().await.unwrap();
    assert_eq!(ok.status(), StatusCode::OK);
    handle.abort();
}
