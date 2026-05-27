use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use rust_decimal::Decimal;
use serde::Deserialize;

use crate::error::OracleError;

/// A single price sample for one feed.
#[derive(Debug, Clone)]
pub struct PriceSample {
    /// Pyth feed identifier (e.g. 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43 for BTC/USD).
    pub feed_id: String,
    /// Normalised price in 1e18-scaled USDC.
    pub price_x18: Decimal,
    /// Source publish time as Unix seconds. Relayer uses this for staleness checks.
    pub publish_time_sec: u64,
    /// Hex bytes payload that can be passed to Pyth's on-chain updatePriceFeeds. None for
    /// sources that don't produce an on-chain-verifiable payload (e.g. the in-memory mock).
    pub update_data: Option<Vec<u8>>,
}

#[async_trait]
pub trait PriceSource: Send + Sync {
    /// Fetch the latest sample for each feed_id. Returns one sample per requested id,
    /// in the same order. Failure on any single feed aborts the batch.
    async fn fetch(&self, feed_ids: &[String]) -> Result<Vec<PriceSample>, OracleError>;
}

// -- Hermes (Pyth public REST) -------------------------------------------

/// REST client for Pyth's public Hermes service. Endpoint:
///   GET {base}/v2/updates/price/latest?ids[]=<feedId>&...
/// Returns: { binary: { data: [...] }, parsed: [{ price: { price, conf, expo, publish_time }, id }] }
pub struct HermesSource {
    base_url: String,
    http: reqwest::Client,
}

impl HermesSource {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            http: reqwest::Client::new(),
        }
    }

    /// Public Pyth Hermes endpoint.
    pub fn mainnet() -> Self {
        Self::new("https://hermes.pyth.network")
    }
}

#[derive(Deserialize)]
struct HermesResponse {
    binary: HermesBinary,
    parsed: Vec<HermesParsed>,
}

#[derive(Deserialize)]
struct HermesBinary {
    data: Vec<String>, // hex strings, one per feed
}

#[derive(Deserialize)]
struct HermesParsed {
    id: String,
    price: HermesPrice,
}

#[derive(Deserialize)]
struct HermesPrice {
    price: String, // signed integer as string
    expo: i32,
    publish_time: u64,
}

#[async_trait]
impl PriceSource for HermesSource {
    async fn fetch(&self, feed_ids: &[String]) -> Result<Vec<PriceSample>, OracleError> {
        let url = format!("{}/v2/updates/price/latest", self.base_url);
        let mut query: Vec<(String, String)> = Vec::new();
        for id in feed_ids {
            query.push(("ids[]".into(), id.clone()));
        }
        let body: HermesResponse = self
            .http
            .get(&url)
            .query(&query)
            .send()
            .await?
            .json()
            .await?;

        if body.parsed.len() != feed_ids.len() {
            return Err(OracleError::Schema(format!(
                "expected {} parsed entries, got {}",
                feed_ids.len(),
                body.parsed.len()
            )));
        }

        // Hermes returns one merged binary VAA covering every requested feed
        // (it is the on-chain `updatePriceFeeds` payload), not one per id.
        // Decode it once and hand the same bytes to every sample; consumers
        // that need to discriminate per feed parse the VAA themselves. When
        // the response is missing the binary section entirely (some staging
        // endpoints), fall back to None so the off-chain consumer still gets
        // its price.
        let shared_update: Option<Vec<u8>> = body
            .binary
            .data
            .first()
            .map(|h| hex_decode(h))
            .transpose()?;

        let mut samples = Vec::with_capacity(feed_ids.len());
        for p in body.parsed.iter() {
            let price_i128: i128 = p
                .price
                .price
                .parse()
                .map_err(|_| OracleError::Schema("price not parseable".into()))?;
            let scaled = scale_to_x18(price_i128, p.price.expo)?;
            samples.push(PriceSample {
                feed_id: p.id.clone(),
                price_x18: scaled,
                publish_time_sec: p.price.publish_time,
                update_data: shared_update.clone(),
            });
        }
        Ok(samples)
    }
}

fn scale_to_x18(price: i128, expo: i32) -> Result<Decimal, OracleError> {
    // result = price * 10^(expo + 18-derived). We use Decimal which already represents
    // price * 10^-scale internally. Decimal accepts (i128 mantissa, u32 scale).
    //
    // For positive price with expo = -8 (e.g. BTC/USD with 8 decimals of precision):
    //   Decimal::new(price, 8) yields price * 10^-8. That is the *actual* USD price.
    //   We want it in our 1e18-scaled USDC convention; for Decimal that just means
    //   keeping the value as-is (Decimal handles arbitrary scale).
    let scale =
        u32::try_from(-expo).map_err(|_| OracleError::Schema("non-negative expo".into()))?;
    Decimal::try_new(price as i64, scale).map_err(|e| OracleError::Schema(e.to_string()))
}

fn hex_decode(s: &str) -> Result<Vec<u8>, OracleError> {
    let s = s.trim_start_matches("0x");
    if s.len() % 2 != 0 {
        return Err(OracleError::Schema("odd-length hex".into()));
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let nibble = |b: u8| -> Result<u8, OracleError> {
        Ok(match b {
            b'0'..=b'9' => b - b'0',
            b'a'..=b'f' => 10 + b - b'a',
            b'A'..=b'F' => 10 + b - b'A',
            _ => return Err(OracleError::Schema("invalid hex char".into())),
        })
    };
    for c in bytes.chunks(2) {
        out.push(nibble(c[0])? * 16 + nibble(c[1])?);
    }
    Ok(out)
}

// -- Mock source ----------------------------------------------------------

/// Deterministic in-memory source for tests and the local devnet stub. Use
/// `set_price` from another thread to drive prices.
#[derive(Default)]
pub struct MockSource {
    samples: Mutex<HashMap<String, PriceSample>>,
}

impl MockSource {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_price(&self, feed_id: impl Into<String>, price_x18: Decimal, publish_time_sec: u64) {
        let feed_id = feed_id.into();
        self.samples.lock().unwrap().insert(
            feed_id.clone(),
            PriceSample {
                feed_id,
                price_x18,
                publish_time_sec,
                update_data: None,
            },
        );
    }
}

#[async_trait]
impl PriceSource for MockSource {
    async fn fetch(&self, feed_ids: &[String]) -> Result<Vec<PriceSample>, OracleError> {
        let map = self.samples.lock().unwrap();
        let mut out = Vec::with_capacity(feed_ids.len());
        for id in feed_ids {
            let s = map
                .get(id)
                .ok_or_else(|| OracleError::UnknownFeed(id.clone()))?;
            out.push(s.clone());
        }
        Ok(out)
    }
}
