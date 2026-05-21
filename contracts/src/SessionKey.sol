// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {ISessionKey} from "./interfaces/ISessionKey.sol";

/// @title SessionKey
/// @notice On-chain registry that binds short-lived session signing keys to a custodial owner.
///         The off-chain edge verifies an Order's signature against the session pubkey, then
///         calls `consume` to debit cumulative notional. Sessions expire automatically and may
///         be revoked at any time by their owner.
contract SessionKey is ISessionKey {
    /// @notice Edge / settlement node authorised to debit notional. Set once at construction
    ///         (the deployer is also the consumer to keep the test surface small); production
    ///         calls `setConsumer` from a timelocked multisig.
    address public consumer;
    address public owner;

    mapping(address sessionPubKey => Session) private _sessions;

    event ConsumerUpdated(address indexed previous, address indexed current);
    event OwnerUpdated(address indexed previous, address indexed current);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner, address _consumer) {
        if (_owner == address(0) || _consumer == address(0)) revert ZeroAddress();
        owner = _owner;
        consumer = _consumer;
        emit OwnerUpdated(address(0), _owner);
        emit ConsumerUpdated(address(0), _consumer);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    function setConsumer(address newConsumer) external onlyOwner {
        if (newConsumer == address(0)) revert ZeroAddress();
        emit ConsumerUpdated(consumer, newConsumer);
        consumer = newConsumer;
    }

    /// @inheritdoc ISessionKey
    function register(address sessionPubKey, uint64 expiresAt, uint128 maxNotionalUsdc) external {
        if (sessionPubKey == address(0)) revert ZeroAddress();
        if (expiresAt <= block.timestamp) revert Expired();
        Session storage s = _sessions[sessionPubKey];
        if (s.active) revert AlreadyRegistered();
        s.owner = msg.sender;
        s.expiresAt = expiresAt;
        s.maxNotionalUsdc = maxNotionalUsdc;
        s.spentNotionalUsdc = 0;
        s.active = true;
        emit SessionRegistered(msg.sender, sessionPubKey, expiresAt, maxNotionalUsdc);
    }

    /// @inheritdoc ISessionKey
    function revoke(address sessionPubKey) external {
        Session storage s = _sessions[sessionPubKey];
        if (!s.active) revert NotActive();
        if (s.owner != msg.sender) revert NotOwner();
        s.active = false;
        emit SessionRevoked(msg.sender, sessionPubKey);
    }

    /// @inheritdoc ISessionKey
    function consume(address sessionPubKey, uint128 amount) external {
        if (msg.sender != consumer) revert NotAuthorizedConsumer();
        Session storage s = _sessions[sessionPubKey];
        if (!s.active) revert NotActive();
        if (block.timestamp >= s.expiresAt) revert Expired();
        uint128 newSpent = s.spentNotionalUsdc + amount;
        if (newSpent > s.maxNotionalUsdc) revert CapExceeded(newSpent, s.maxNotionalUsdc);
        s.spentNotionalUsdc = newSpent;
        emit NotionalConsumed(sessionPubKey, amount, newSpent);
    }

    /// @inheritdoc ISessionKey
    function session(address sessionPubKey) external view returns (Session memory) {
        return _sessions[sessionPubKey];
    }

    /// @inheritdoc ISessionKey
    function isValid(address sessionPubKey) external view returns (bool) {
        Session memory s = _sessions[sessionPubKey];
        return s.active && block.timestamp < s.expiresAt && s.spentNotionalUsdc < s.maxNotionalUsdc;
    }
}
