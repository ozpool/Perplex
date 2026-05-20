// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

interface ISettlementEngine {
    struct Fill {
        address user;
        bytes32 marketId;
        int256 sizeDelta; // signed, 1e18 base-asset
        uint256 priceX18; // 1e18 USDC
        int256 fee; // signed, 1e18 USDC — negative = taker paid, positive = maker rebate
    }

    event BatchApplied(uint256 indexed nonce, address indexed operator, uint256 fillCount);
    event FillSettled(
        address indexed user, bytes32 indexed marketId, int256 realisedPnl, int256 fundingDelta, int256 fee
    );
    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);

    error NotOwner();
    error AlreadyWired();
    error BadSignature();
    error BatchExpired();
    error NonceUsed(uint256 nonce);
    error EmptyBatch();
    error ZeroAddress();

    function applyBatch(Fill[] calldata fills, uint256 nonce, uint64 deadline, bytes calldata signature)
        external;

    function nonceUsed(uint256 nonce) external view returns (bool);

    function operator() external view returns (address);

    function FILL_TYPEHASH() external view returns (bytes32);

    function BATCH_TYPEHASH() external view returns (bytes32);
}
