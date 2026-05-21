// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

interface ISessionKey {
    struct Session {
        address owner;
        uint64 expiresAt;
        uint128 maxNotionalUsdc; // 6-decimal raw USDC
        uint128 spentNotionalUsdc;
        bool active;
    }

    event SessionRegistered(
        address indexed owner, address indexed sessionPubKey, uint64 expiresAt, uint128 maxNotionalUsdc
    );
    event SessionRevoked(address indexed owner, address indexed sessionPubKey);
    event NotionalConsumed(address indexed sessionPubKey, uint128 amount, uint128 spent);

    error NotOwner();
    error ZeroAddress();
    error AlreadyRegistered();
    error NotActive();
    error Expired();
    error NotAuthorizedConsumer();
    error CapExceeded(uint128 spent, uint128 cap);

    /// @notice Owner-only register: bind `sessionPubKey` to `msg.sender` with an expiry and a
    ///         cumulative notional cap. Reverts if already registered.
    function register(address sessionPubKey, uint64 expiresAt, uint128 maxNotionalUsdc) external;

    /// @notice Owner-only revoke. Deactivates the session.
    function revoke(address sessionPubKey) external;

    /// @notice Edge-only debit of cumulative notional. Reverts when spent + amount > cap or
    ///         when the session is inactive / expired.
    function consume(address sessionPubKey, uint128 amount) external;

    function session(address sessionPubKey) external view returns (Session memory);
    function isValid(address sessionPubKey) external view returns (bool);
}
