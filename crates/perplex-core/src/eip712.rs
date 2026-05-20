//! EIP-712 typed-data domain and struct definitions for Order and SessionKey.
//! Mirrors api-contract.md Section 3 and on-chain SettlementEngine domain.

use alloy::sol;

sol! {
    struct Order {
        address owner;
        bytes32 marketId;
        uint8 side;
        uint8 orderType;
        uint256 price;
        uint256 qty;
        uint8 timeInForce;
        bool reduceOnly;
        bool postOnly;
        uint256 nonce;
        uint64 expiryTsSec;
    }

    struct SessionKey {
        address owner;
        address sessionPubKey;
        uint64 expiryTsSec;
        uint256 maxNotionalUsdc;
        bytes32[] allowedMarkets;
        uint256 nonce;
    }
}

pub const DOMAIN_NAME: &str = "Perplex";
pub const DOMAIN_VERSION: &str = "1";
