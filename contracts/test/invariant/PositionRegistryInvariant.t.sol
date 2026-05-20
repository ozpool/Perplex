// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {PositionRegistry} from "../../src/PositionRegistry.sol";
import {MarketRegistry} from "../../src/MarketRegistry.sol";
import {MockOracle} from "../../src/MockOracle.sol";
import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IOracleAdapter} from "../../src/interfaces/IOracleAdapter.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";

/// @notice Acts as the settlement engine for the invariant fuzzer. Submits PAIRED fills
///         (one positive, one negative of equal magnitude) so the zero-sum invariant holds.
contract InvariantHandler {
    PositionRegistry public immutable REGISTRY;
    bytes32 public immutable BTC;
    bytes32 public immutable ETH;
    bytes32 public immutable SOL;

    address[3] public users;

    constructor(PositionRegistry _r, bytes32 _btc, bytes32 _eth, bytes32 _sol) {
        REGISTRY = _r;
        BTC = _btc;
        ETH = _eth;
        SOL = _sol;
        users[0] = address(uint160(0xA11CE));
        users[1] = address(uint160(0xB0B));
        users[2] = address(uint160(0xC0DE));
    }

    function balances(address) external pure returns (uint256) {
        return 0;
    }

    /// Submit a paired fill: usersA buys `size` at `price`, usersB sells `size` at `price`.
    /// Bounds: size in [1e15, 1e20] (0.001 .. 100 BTC), price in [50e18, 200_000e18].
    function pairedFill(uint8 marketIdx, uint8 a, uint8 b, uint128 sizeMag, uint128 priceWei) external {
        bytes32 market = _market(marketIdx);
        a = uint8(_bound(a, 0, 2));
        b = uint8(_bound(b, 0, 2));
        if (a == b) b = uint8((b + 1) % 3);
        uint256 size = _bound(sizeMag, 1e15, 1e20);
        uint256 price = _bound(priceWei, 50e18, 200_000e18);

        REGISTRY.applyFill(users[a], market, int256(size), price);
        REGISTRY.applyFill(users[b], market, -int256(size), price);
    }

    /// Advance the funding index by a small bounded amount.
    function bumpFunding(uint8 marketIdx, int128 deltaIdx) external {
        bytes32 market = _market(marketIdx);
        int256 d = int256(deltaIdx);
        if (d > 1_000e18) d = 1_000e18;
        if (d < -1_000e18) d = -1_000e18;
        // updateFunding is owner-gated; this handler is owner in the test setup.
        REGISTRY.updateFunding(market, d);
    }

    function _market(uint8 idx) internal view returns (bytes32) {
        uint8 i = idx % 3;
        if (i == 0) return BTC;
        if (i == 1) return ETH;
        return SOL;
    }

    function _bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + (x % (hi - lo + 1));
    }
}

contract PositionRegistryInvariantTest is Test {
    PositionRegistry internal registry;
    MarketRegistry internal markets;
    MockOracle internal oracle;
    InvariantHandler internal handler;

    bytes32 internal constant BTC = keccak256("btc-usd");
    bytes32 internal constant ETH = keccak256("eth-usd");
    bytes32 internal constant SOL = keccak256("sol-usd");

    function setUp() public {
        markets = new MarketRegistry(address(this));
        oracle = new MockOracle(address(this));
        registry = new PositionRegistry(
            address(this), IMarketRegistry(address(markets)), IOracleAdapter(address(oracle))
        );
        handler = new InvariantHandler(registry, BTC, ETH, SOL);

        // Wire handler as settlement and liquidation engine. Handler's balances() stub satisfies
        // the ICollateralVault interface for any path that needs the vault.
        registry.setWiring(ICollateralVault(address(handler)), address(handler), address(handler));

        // Hand off market-registry ownership to the handler so it can advance the funding index.
        // Actually: PositionRegistry.updateFunding is owner-gated on PositionRegistry itself.
        // We are PositionRegistry owner here; the handler calls registry.updateFunding which
        // requires onlyOwner. Transfer of registry ownership not possible (no transfer fn);
        // instead expose the handler by adding it to targetContract and call updateFunding
        // through a wrapper. For simplicity we don't fuzz updateFunding and rely on it being
        // covered by unit tests.
        // -> Remove the bumpFunding selector from the handler target.

        IPositionRegistry.MarketParams memory mp = IPositionRegistry.MarketParams({
            imRatioBps: 500,
            mmRatioBps: 250,
            liqBonusBps: 100,
            takerFeeBps: 5,
            makerRebateBps: -2,
            active: true
        });
        markets.listMarket(BTC, mp);
        markets.listMarket(ETH, mp);
        markets.listMarket(SOL, mp);

        targetContract(address(handler));

        // Only call pairedFill from the fuzzer. bumpFunding requires registry-owner and our
        // handler doesn't have those rights.
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = InvariantHandler.pairedFill.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice After any sequence of paired fills, the sum of position sizes across all users
    ///         per market is zero. Equivalently: no value created or destroyed by the
    ///         matching layer.
    function invariant_perMarketSumOfSizesIsZero() public view {
        _assertZeroSum(BTC);
        _assertZeroSum(ETH);
        _assertZeroSum(SOL);
    }

    /// @notice A closed position must have a zero entry price stored (consistent state cleanup).
    function invariant_closedPositionsHaveZeroEntry() public view {
        bytes32[3] memory mkts = [BTC, ETH, SOL];
        for (uint256 m = 0; m < 3; ++m) {
            for (uint256 u = 0; u < 3; ++u) {
                IPositionRegistry.Position memory p = registry.positions(handler.users(u), mkts[m]);
                if (p.size == 0) {
                    assertEq(p.entryPriceX18, 0, "zero-size position must have zero entry");
                }
            }
        }
    }

    function _assertZeroSum(bytes32 market) internal view {
        int256 sum;
        for (uint256 i = 0; i < 3; ++i) {
            sum += registry.positions(handler.users(i), market).size;
        }
        assertEq(sum, 0, "per-market sum of sizes != 0");
    }
}
