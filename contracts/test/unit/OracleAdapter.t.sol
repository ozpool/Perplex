// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

import {OracleAdapter} from "../../src/OracleAdapter.sol";
import {IOracleAdapter} from "../../src/interfaces/IOracleAdapter.sol";
import {IChainlinkAggregator} from "../../src/interfaces/IChainlinkAggregator.sol";

/// @notice Minimal Chainlink stub for OracleAdapter tests. Returns whatever the test sets.
contract MockChainlink is IChainlinkAggregator {
    int256 public answer;
    uint8 public override decimals;
    uint256 public updatedAt;

    constructor(uint8 _decimals) {
        decimals = _decimals;
    }

    function setRound(int256 _answer, uint256 _updatedAt) external {
        answer = _answer;
        updatedAt = _updatedAt;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

    contract OracleAdapterTest is Test {
        MockPyth internal pyth;
        OracleAdapter internal adapter;

        address internal owner = makeAddr("owner");
        bytes32 internal constant BTC = keccak256("btc-usd");
        bytes32 internal constant PYTH_BTC = bytes32(uint256(1));

        function setUp() public {
            // MockPyth(validTimePeriod, singleUpdateFeeInWei). validTimePeriod is the staleness
            // window — set generously here; OracleAdapter applies its own.
            pyth = new MockPyth(3600, 0);
            adapter = new OracleAdapter(pyth, owner);
            vm.prank(owner);
            adapter.registerPythFeed(BTC, PYTH_BTC);
        }

        function _pushPythPrice(int64 price, int32 expo, uint256 publishTime) internal {
            bytes[] memory updates = new bytes[](1);
            uint64 conf = uint64(uint256(int256(price > 0 ? price : -price))) / 100;
            updates[0] =
                pyth.createPriceFeedUpdateData(PYTH_BTC, price, conf, expo, price, conf, uint64(publishTime));
            uint256 fee = pyth.getUpdateFee(updates);
            pyth.updatePriceFeeds{value: fee}(updates);
        }

        // -- constructor ----------------------------------------------------------

        function test_constructorRevertsOnZeroPyth() public {
            vm.expectRevert(OracleAdapter.ZeroAddress.selector);
            new OracleAdapter(MockPyth(address(0)), owner);
        }

        function test_constructorRevertsOnZeroOwner() public {
            vm.expectRevert(OracleAdapter.ZeroAddress.selector);
            new OracleAdapter(pyth, address(0));
        }

        function test_defaults() public view {
            assertEq(adapter.maxStalenessSec(), 30);
            assertEq(adapter.maxDivergenceBps(), 100);
        }

        // -- priceX18 -------------------------------------------------------------

        function test_priceX18ScalesNegativeExpo() public {
            // 100_000 USDC at expo=-8 -> 100_000 * 10^(18-8) = 100_000e10 = 1e15
            // i.e. price field = 10_000_000_000_000 (1e13), expo = -8 means 10_000_000_000_000 * 10^-8 = 100_000
            // Pyth wire format: price=10_000_000_000_000, expo=-8 (8 decimals).
            // To 1e18: price * 10^(18 + expo) = 1e13 * 10^10 = 1e23 = 100_000e18 ✓
            _pushPythPrice(10_000_000_000_000, -8, block.timestamp);
            assertEq(adapter.priceX18(BTC), 100_000e18);
        }

        function test_priceX18RevertsOnUnknownFeed() public {
            vm.expectRevert(abi.encodeWithSelector(IOracleAdapter.UnknownFeed.selector, keccak256("eth-usd")));
            adapter.priceX18(keccak256("eth-usd"));
        }

        function test_priceX18RevertsWhenStale() public {
            _pushPythPrice(10_000_000_000_000, -8, block.timestamp);
            // Advance past 30s default staleness.
            vm.warp(block.timestamp + 60);
            vm.expectRevert(); // MockPyth's getPriceNoOlderThan reverts with its own selector
            adapter.priceX18(BTC);
        }

        function test_priceX18RevertsOnNegativePrice() public {
            _pushPythPrice(-5, -8, block.timestamp);
            vm.expectRevert(abi.encodeWithSelector(IOracleAdapter.NegativePrice.selector, BTC));
            adapter.priceX18(BTC);
        }

        // -- Chainlink sanity bound ----------------------------------------------

        function test_priceX18AgreesWithChainlink() public {
            _pushPythPrice(10_000_000_000_000, -8, block.timestamp);
            MockChainlink cl = new MockChainlink(8);
            // Same price (100_000), expo 8 -> answer = 100_000 * 1e8 = 1e13
            cl.setRound(int256(uint256(10_000_000_000_000)), block.timestamp);
            vm.prank(owner);
            adapter.setChainlinkFeed(BTC, cl);

            // Should pass the divergence check.
            assertEq(adapter.priceX18(BTC), 100_000e18);
        }

        function test_priceX18RevertsOnChainlinkDivergence() public {
            _pushPythPrice(10_000_000_000_000, -8, block.timestamp); // Pyth: 100_000
            MockChainlink cl = new MockChainlink(8);
            // Chainlink: 102_000 — 2% divergence; default max is 100bps (1%) -> reverts.
            cl.setRound(int256(uint256(10_200_000_000_000)), block.timestamp);
            vm.prank(owner);
            adapter.setChainlinkFeed(BTC, cl);

            vm.expectRevert();
            adapter.priceX18(BTC);
        }

        function test_priceX18RevertsOnChainlinkStale() public {
            // Warp first so we have a base timestamp far enough in the future that a
            // stale Chainlink round (updated 2+ hours earlier) actually triggers the check.
            vm.warp(7200);
            _pushPythPrice(10_000_000_000_000, -8, block.timestamp);

            MockChainlink cl = new MockChainlink(8);
            // Chainlink last updated at t=0, 2 hours stale -> ChainlinkStale.
            cl.setRound(int256(uint256(10_000_000_000_000)), 0);
            vm.prank(owner);
            adapter.setChainlinkFeed(BTC, cl);

            vm.expectRevert(abi.encodeWithSelector(OracleAdapter.ChainlinkStale.selector, BTC));
            adapter.priceX18(BTC);
        }

        function test_clearChainlinkFeedDisablesSanity() public {
            _pushPythPrice(10_000_000_000_000, -8, block.timestamp);
            MockChainlink cl = new MockChainlink(8);
            cl.setRound(int256(uint256(10_200_000_000_000)), block.timestamp);
            vm.startPrank(owner);
            adapter.setChainlinkFeed(BTC, cl);
            // After clear, Pyth-only path is enabled and divergent Chainlink is ignored.
            adapter.setChainlinkFeed(BTC, IChainlinkAggregator(address(0)));
            vm.stopPrank();
            assertEq(adapter.priceX18(BTC), 100_000e18);
        }

        // -- updateAndGetPrice ---------------------------------------------------

        function test_updateAndGetPriceSubmitsAndReturns() public {
            bytes[] memory updates = new bytes[](1);
            updates[0] = pyth.createPriceFeedUpdateData(
                PYTH_BTC, 10_000_000_000_000, 100, -8, 10_000_000_000_000, 100, uint64(block.timestamp)
            );
            uint256 fee = pyth.getUpdateFee(updates);

            uint256 p = adapter.updateAndGetPrice{value: fee}(BTC, updates);
            assertEq(p, 100_000e18);
        }

        function test_updateAndGetPriceRevertsOnInsufficientFee() public {
            bytes[] memory updates = new bytes[](1);
            updates[0] = pyth.createPriceFeedUpdateData(
                PYTH_BTC, 10_000_000_000_000, 100, -8, 10_000_000_000_000, 100, uint64(block.timestamp)
            );
            // MockPyth's singleUpdateFeeInWei is 0 in our setUp, so any value works.
            // Recreate with positive fee.
            MockPyth feePyth = new MockPyth(3600, 1 wei);
            OracleAdapter feeAdapter = new OracleAdapter(feePyth, owner);
            vm.prank(owner);
            feeAdapter.registerPythFeed(BTC, PYTH_BTC);

            vm.expectRevert(OracleAdapter.InvalidUpdateFee.selector);
            feeAdapter.updateAndGetPrice{value: 0}(BTC, updates);
        }

        // -- admin ---------------------------------------------------------------

        function test_setMaxStalenessRejectsZero() public {
            vm.prank(owner);
            vm.expectRevert(OracleAdapter.InvalidStaleness.selector);
            adapter.setMaxStaleness(0);
        }

        function test_setMaxDivergenceRejectsZero() public {
            vm.prank(owner);
            vm.expectRevert(OracleAdapter.InvalidDivergence.selector);
            adapter.setMaxDivergence(0);
        }

        function test_setMaxDivergenceRejectsAboveMax() public {
            vm.prank(owner);
            vm.expectRevert(OracleAdapter.InvalidDivergence.selector);
            adapter.setMaxDivergence(10_001);
        }

        function test_transferOwnership() public {
            address newOwner = makeAddr("newOwner");
            vm.prank(owner);
            adapter.transferOwnership(newOwner);
            assertEq(adapter.owner(), newOwner);
        }

        function test_transferOwnershipRevertsForNonOwner() public {
            vm.prank(makeAddr("mallory"));
            vm.expectRevert(OracleAdapter.NotOwner.selector);
            adapter.transferOwnership(makeAddr("mallory"));
        }

        receive() external payable {}
    }
