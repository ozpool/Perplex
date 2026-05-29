//! End-to-end test: boot the server on a random port and hit every endpoint defined in
//! api-contract.md sections 1.1-1.11. Covers status code, content-type, and a minimal shape
//! check on the JSON body. Auth path uses the dev-only `/__dev/token/:address` helper.

use std::time::Duration;

use perplex_edge::{build_router_with_dev_token_for_tests, AppState};
use reqwest::StatusCode;
use serde_json::Value;

mod helpers {
    pub use k256::ecdsa::SigningKey;
    use k256::ecdsa::VerifyingKey;
    use sha3::{Digest, Keccak256};

    pub fn jwt_secret() -> Vec<u8> {
        b"e2e-test-secret-not-for-prod".to_vec()
    }

    fn keccak_addr(vk: &VerifyingKey) -> String {
        let point = vk.to_encoded_point(false);
        let mut h = Keccak256::new();
        h.update(&point.as_bytes()[1..]);
        format!("0x{}", hex::encode(&h.finalize()[12..]))
    }

    pub fn eth_address(sk: &SigningKey) -> String {
        keccak_addr(sk.verifying_key())
    }

    /// Produce an EIP-191 personal_sign signature (`0x` + 65 bytes, v = 27/28).
    pub fn personal_sign(sk: &SigningKey, msg: &str) -> String {
        let mut hasher = Keccak256::new();
        hasher.update(format!("\x19Ethereum Signed Message:\n{}", msg.len()).as_bytes());
        hasher.update(msg.as_bytes());
        let (sig, recid) = sk.sign_prehash_recoverable(&hasher.finalize()).unwrap();
        let mut bytes = sig.to_bytes().to_vec();
        bytes.push(recid.to_byte() + 27);
        format!("0x{}", hex::encode(&bytes))
    }
}

async fn spawn_server() -> (String, tokio::task::JoinHandle<()>) {
    // new_dev so the dev-token path seeds the wallet with collateral; the order
    // endpoints now enforce a margin gate, so an unfunded account can't place.
    let state = AppState::new_dev(helpers::jwt_secret());
    let router = build_router_with_dev_token_for_tests(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });
    // give the listener a tick to settle
    tokio::time::sleep(Duration::from_millis(50)).await;
    (format!("http://127.0.0.1:{port}"), handle)
}

async fn dev_token(client: &reqwest::Client, base: &str, addr: &str) -> String {
    let resp: serde_json::Value = client
        .get(format!("{base}/__dev/token/{addr}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    resp["jwt"]
        .as_str()
        .expect("dev_token returns a {jwt, expiresAt} JSON body")
        .to_string()
}

#[tokio::test]
async fn e2e_all_eleven_endpoints() {
    let (base, handle) = spawn_server().await;
    let client = reqwest::Client::new();
    let addr = "0x000000000000000000000000000000000000aBcD";
    let bearer = dev_token(&client, &base, addr).await;
    let auth_value = format!("Bearer {bearer}");

    // 1.1 markets — public.
    let res = client
        .get(format!("{base}/v1/markets"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.1 markets status");
    let body: Value = res.json().await.unwrap();
    assert!(body["markets"].as_array().unwrap().len() >= 3);

    // 1.2 orderbook.
    let res = client
        .get(format!("{base}/v1/orderbook/btc-usd?depth=50"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.2 orderbook");
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["marketId"], "btc-usd");

    // 1.2 orderbook — unknown market 404.
    let res = client
        .get(format!("{base}/v1/orderbook/nope"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 1.3 trades.
    let res = client
        .get(format!("{base}/v1/trades/btc-usd?limit=10"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.3 trades");
    let body: Value = res.json().await.unwrap();
    assert!(body["trades"].is_array());

    // 1.4 funding.
    let res = client
        .get(format!("{base}/v1/funding/btc-usd?range=24h"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.4 funding");
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["marketId"], "btc-usd");

    // 1.10 SIWE — generate a real keypair, sign the message, and verify. The
    // verify endpoint now recovers the signer, so a fake signature is rejected.
    let signer = helpers::SigningKey::from_slice(&[0x42u8; 32]).unwrap();
    let siwe_addr = helpers::eth_address(&signer);
    let res = client
        .post(format!("{base}/v1/auth/siwe/nonce"))
        .json(&serde_json::json!({"address": siwe_addr}))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.10 nonce");
    let body: Value = res.json().await.unwrap();
    let nonce = body["nonce"].as_str().unwrap().to_string();

    let siwe_msg = format!(
        "perplex.local wants you to sign in\nAddress: {siwe_addr}\nNonce: {nonce}\nIssued At: 2026-05-20T12:00:00Z"
    );
    let siwe_sig = helpers::personal_sign(&signer, &siwe_msg);
    let res = client
        .post(format!("{base}/v1/auth/siwe/verify"))
        .json(&serde_json::json!({"message": siwe_msg, "signature": siwe_sig}))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.10 verify");
    let body: Value = res.json().await.unwrap();
    assert!(!body["jwt"].as_str().unwrap().is_empty());

    // A forged signature for the same message must be rejected.
    let res = client
        .post(format!("{base}/v1/auth/siwe/verify"))
        .json(&serde_json::json!({"message": siwe_msg, "signature": "0x".to_string() + &"00".repeat(65)}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        res.status(),
        StatusCode::UNAUTHORIZED,
        "forged siwe rejected"
    );

    // 1.5 place order — authed.
    let order_req = serde_json::json!({
        "marketId": "btc-usd",
        "side": "buy",
        "type": "limit",
        "price": "99500.0",
        "qty": "0.1",
        "timeInForce": "gtc",
        "reduceOnly": false,
        "postOnly": false,
        "clientOrderId": "cli-001",
        "nonce": "1716192000123456789",
        "signature": "0x".to_string() + &"00".repeat(65),
    });
    let res = client
        .post(format!("{base}/v1/orders"))
        .header("Authorization", &auth_value)
        .json(&order_req)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.5 place");
    let body: Value = res.json().await.unwrap();
    let order_id = body["orderId"].as_str().unwrap().to_string();

    // 1.7 open orders.
    let res = client
        .get(format!("{base}/v1/orders/open"))
        .header("Authorization", &auth_value)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.7 open orders");
    let body: Value = res.json().await.unwrap();
    let orders = body["orders"].as_array().unwrap();
    assert!(orders.iter().any(|o| o["id"] == order_id));

    // 1.6 cancel order — idempotent.
    let res = client
        .delete(format!("{base}/v1/orders/{order_id}"))
        .header("Authorization", &auth_value)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.6 cancel");
    let res = client
        .delete(format!("{base}/v1/orders/{order_id}"))
        .header("Authorization", &auth_value)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.6 cancel idempotent");

    // 1.8 positions.
    let res = client
        .get(format!("{base}/v1/positions"))
        .header("Authorization", &auth_value)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.8 positions");

    // 1.9 fills.
    let res = client
        .get(format!("{base}/v1/fills?limit=100"))
        .header("Authorization", &auth_value)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.9 fills");

    // 1.11 balance.
    let res = client
        .get(format!("{base}/v1/account/balance"))
        .header("Authorization", &auth_value)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "1.11 balance");

    // Auth missing on authed route → 401.
    let res = client
        .get(format!("{base}/v1/positions"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // OpenAPI doc served.
    let res = client
        .get(format!("{base}/docs/openapi.json"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["info"]["title"], "Perplex Edge API");

    handle.abort();
}

#[tokio::test]
async fn place_order_rejects_unknown_market() {
    let (base, handle) = spawn_server().await;
    let client = reqwest::Client::new();
    let bearer = dev_token(&client, &base, "0x000000000000000000000000000000000000aBcD").await;
    let res = client
        .post(format!("{base}/v1/orders"))
        .bearer_auth(bearer)
        .json(&serde_json::json!({
            "marketId": "nope-usd",
            "side": "buy",
            "type": "limit",
            "price": "1",
            "qty": "1",
            "timeInForce": "gtc",
            "nonce": "1",
            "signature": "0x".to_string() + &"00".repeat(65),
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    handle.abort();
}

#[tokio::test]
async fn place_order_rejects_undercollateralised() {
    let (base, handle) = spawn_server().await;
    let client = reqwest::Client::new();
    // Dev-seeded wallet holds 100k USDC. A 100 BTC position at ~99.5k is ~$10M
    // notional → far more initial margin than 100k covers → must be rejected.
    let bearer = dev_token(&client, &base, "0x00000000000000000000000000000000DeadBeef").await;
    let res = client
        .post(format!("{base}/v1/orders"))
        .bearer_auth(&bearer)
        .json(&serde_json::json!({
            "marketId": "btc-usd",
            "side": "buy",
            "type": "limit",
            "price": "99500.0",
            "qty": "100",
            "timeInForce": "gtc",
            "nonce": "1",
            "signature": "0x".to_string() + &"00".repeat(65),
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN, "oversized order");
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["error"]["code"], "INSUFFICIENT_MARGIN");

    // A small, well-collateralised order on the same wallet still goes through.
    let res = client
        .post(format!("{base}/v1/orders"))
        .bearer_auth(&bearer)
        .json(&serde_json::json!({
            "marketId": "btc-usd",
            "side": "buy",
            "type": "limit",
            "price": "99500.0",
            "qty": "0.1",
            "timeInForce": "gtc",
            "nonce": "2",
            "signature": "0x".to_string() + &"00".repeat(65),
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "small order within margin");
    handle.abort();
}

#[tokio::test]
async fn fills_charge_fee_and_settle_vault() {
    let (base, handle) = spawn_server().await;
    let client = reqwest::Client::new();
    let maker = "0x000000000000000000000000000000000000Ma01";
    let taker = "0x000000000000000000000000000000000000Ta01";
    let maker_jwt = format!("Bearer {}", dev_token(&client, &base, maker).await);
    let taker_jwt = format!("Bearer {}", dev_token(&client, &base, taker).await);

    // Maker rests a sell; taker market-buys into it so a fill happens.
    let rest = serde_json::json!({
        "marketId": "btc-usd", "side": "sell", "type": "limit",
        "price": "99500.0", "qty": "0.5", "timeInForce": "gtc",
        "reduceOnly": false, "postOnly": false, "nonce": "1",
        "signature": "0x".to_string() + &"00".repeat(65),
    });
    let res = client
        .post(format!("{base}/v1/orders"))
        .header("Authorization", &maker_jwt)
        .json(&rest)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "maker rest");

    let take = serde_json::json!({
        "marketId": "btc-usd", "side": "buy", "type": "market",
        "qty": "0.1", "timeInForce": "ioc",
        "reduceOnly": false, "postOnly": false, "nonce": "2",
        "signature": "0x".to_string() + &"00".repeat(65),
    });
    let res = client
        .post(format!("{base}/v1/orders"))
        .header("Authorization", &taker_jwt)
        .json(&take)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "taker fill");

    // Taker's fill now carries a non-zero fee (was hardcoded "0").
    let fills: Value = client
        .get(format!("{base}/v1/fills?limit=10"))
        .header("Authorization", &taker_jwt)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let fee = fills["fills"][0]["feeUsdc"].as_str().unwrap();
    assert_ne!(fee, "0", "taker fill should carry a fee");
    assert!(
        fee.parse::<i64>().unwrap() > 0,
        "taker fee is a positive charge"
    );

    // And the fee was debited from the taker's vault (seeded 100k = 100000000000).
    let bal: Value = client
        .get(format!("{base}/v1/account/balance"))
        .header("Authorization", &taker_jwt)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let vault = bal["vaultBalanceUsdc"]
        .as_str()
        .unwrap()
        .parse::<i64>()
        .unwrap();
    assert!(vault < 100_000_000_000, "taker vault debited by the fee");

    handle.abort();
}
