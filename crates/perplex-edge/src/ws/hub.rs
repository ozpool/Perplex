//! Topic broadcast hub.
//!
//! Publishers call `Hub::publish(topic, msg)` and the hub fans the message out to every
//! subscriber's bounded mpsc. When a subscriber's mailbox is full the hub drops them: the
//! contract is "no slow-consumer back-pressure on the publisher".

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::mpsc;

/// Maximum queued messages per subscriber. Slow client gets dropped on overflow.
pub const MAX_QUEUE: usize = 1000;

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub enum Topic {
    Orderbook(String),
    Trades(String),
    Oracle(String),
    Funding(String),
    UserFills(String),     // address
    UserPositions(String), // address
}

impl Topic {
    pub fn parse(s: &str) -> Option<Self> {
        if let Some(rest) = s.strip_prefix("orderbook.") {
            Some(Topic::Orderbook(rest.to_string()))
        } else if let Some(rest) = s.strip_prefix("trades.") {
            Some(Topic::Trades(rest.to_string()))
        } else if let Some(rest) = s.strip_prefix("oracle.") {
            Some(Topic::Oracle(rest.to_string()))
        } else if let Some(rest) = s.strip_prefix("funding.") {
            Some(Topic::Funding(rest.to_string()))
        } else if s == "user.fills" {
            Some(Topic::UserFills(String::new()))
        } else if s == "user.positions" {
            Some(Topic::UserPositions(String::new()))
        } else {
            None
        }
    }

    /// Does subscribing to this topic require an authenticated user?
    pub fn requires_auth(&self) -> bool {
        matches!(self, Topic::UserFills(_) | Topic::UserPositions(_))
    }

    /// Bind the topic to a concrete user address (private channels only).
    /// Addresses are lowercased so subscribe-side (JWT subject) and
    /// publish-side (state mutation) always hash to the same bucket.
    pub fn with_user(&self, address: &str) -> Self {
        let addr = address.to_lowercase();
        match self {
            Topic::UserFills(_) => Topic::UserFills(addr),
            Topic::UserPositions(_) => Topic::UserPositions(addr),
            other => other.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Message {
    pub topic: Topic,
    pub payload: serde_json::Value,
}

#[derive(Default)]
struct Inner {
    /// topic -> [(subscriber_id, sender)]
    subs: HashMap<Topic, Vec<(u64, mpsc::Sender<Message>)>>,
    next_id: u64,
}

#[derive(Clone, Default)]
pub struct Hub {
    inner: Arc<Mutex<Inner>>,
}

impl Hub {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a new subscriber for `topic`. Returns the receiver + a handle the connection
    /// uses to unsubscribe on disconnect.
    pub fn subscribe(&self, topic: Topic) -> (u64, mpsc::Receiver<Message>) {
        let (tx, rx) = mpsc::channel(MAX_QUEUE);
        let mut g = self.inner.lock();
        let id = g.next_id;
        g.next_id += 1;
        g.subs.entry(topic).or_default().push((id, tx));
        (id, rx)
    }

    pub fn unsubscribe(&self, topic: &Topic, id: u64) {
        let mut g = self.inner.lock();
        if let Some(list) = g.subs.get_mut(topic) {
            list.retain(|(sid, _)| *sid != id);
            if list.is_empty() {
                g.subs.remove(topic);
            }
        }
    }

    /// Fan `msg` out to every subscriber on the topic. Subscribers whose mailbox is full are
    /// removed from the hub — they will not receive any further messages and the connection
    /// task will observe the channel close and drop the socket.
    pub fn publish(&self, msg: Message) -> usize {
        let mut g = self.inner.lock();
        let mut delivered = 0usize;
        if let Some(list) = g.subs.get_mut(&msg.topic) {
            list.retain(|(_, tx)| match tx.try_send(msg.clone()) {
                Ok(()) => {
                    delivered += 1;
                    true
                }
                Err(mpsc::error::TrySendError::Full(_)) => false, // drop slow subscriber
                Err(mpsc::error::TrySendError::Closed(_)) => false,
            });
        }
        delivered
    }

    pub fn subscriber_count(&self, topic: &Topic) -> usize {
        self.inner
            .lock()
            .subs
            .get(topic)
            .map(|l| l.len())
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn publish_fans_out_to_subscribers() {
        let hub = Hub::new();
        let (_, mut rx1) = hub.subscribe(Topic::Trades("btc-usd".into()));
        let (_, mut rx2) = hub.subscribe(Topic::Trades("btc-usd".into()));

        let n = hub.publish(Message {
            topic: Topic::Trades("btc-usd".into()),
            payload: serde_json::json!({"price": "100"}),
        });
        assert_eq!(n, 2);
        assert!(rx1.recv().await.is_some());
        assert!(rx2.recv().await.is_some());
    }

    #[tokio::test]
    async fn slow_subscriber_dropped_after_queue_fills() {
        let hub = Hub::new();
        let (id, _rx) = hub.subscribe(Topic::Trades("btc-usd".into()));
        // Never read from _rx; saturate the mailbox.
        for _ in 0..MAX_QUEUE {
            assert_eq!(
                hub.publish(Message {
                    topic: Topic::Trades("btc-usd".into()),
                    payload: serde_json::json!({}),
                }),
                1
            );
        }
        // (MAX_QUEUE+1)th publish should drop the slow subscriber.
        let delivered = hub.publish(Message {
            topic: Topic::Trades("btc-usd".into()),
            payload: serde_json::json!({}),
        });
        assert_eq!(delivered, 0);
        assert_eq!(hub.subscriber_count(&Topic::Trades("btc-usd".into())), 0);
        // No-op unsub on a dropped subscriber is safe.
        hub.unsubscribe(&Topic::Trades("btc-usd".into()), id);
    }

    #[test]
    fn topic_parses_each_channel() {
        assert!(matches!(
            Topic::parse("orderbook.btc-usd"),
            Some(Topic::Orderbook(_))
        ));
        assert!(matches!(
            Topic::parse("trades.eth-usd"),
            Some(Topic::Trades(_))
        ));
        assert!(matches!(
            Topic::parse("oracle.sol-usd"),
            Some(Topic::Oracle(_))
        ));
        assert!(matches!(
            Topic::parse("user.fills"),
            Some(Topic::UserFills(_))
        ));
        assert!(matches!(
            Topic::parse("user.positions"),
            Some(Topic::UserPositions(_))
        ));
        assert!(Topic::parse("bogus.btc-usd").is_none());
    }

    #[test]
    fn private_topics_require_auth() {
        assert!(Topic::parse("user.fills").unwrap().requires_auth());
        assert!(Topic::parse("user.positions").unwrap().requires_auth());
        assert!(!Topic::parse("orderbook.btc-usd").unwrap().requires_auth());
    }
}
