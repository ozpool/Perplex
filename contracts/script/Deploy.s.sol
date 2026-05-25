// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {PositionRegistry} from "../src/PositionRegistry.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {SettlementEngine} from "../src/SettlementEngine.sol";
import {SyntheticCounterparty} from "../src/SyntheticCounterparty.sol";
import {IMarketRegistry} from "../src/interfaces/IMarketRegistry.sol";
import {IPositionRegistry} from "../src/interfaces/IPositionRegistry.sol";
import {IOracleAdapter} from "../src/interfaces/IOracleAdapter.sol";
import {ICollateralVault} from "../src/interfaces/ICollateralVault.sol";

/// @notice Deterministic deploy for local anvil (chain id 31337). Writes addresses to
///         contracts/deployments/anvil.json so scripts/seed.ts can consume them.
contract Deploy is Script {
    struct Deployments {
        address mockUsdc;
        address mockOracle;
        address marketRegistry;
        address positionRegistry;
        address collateralVault;
        address settlementEngine;
        address syntheticCounterparty;
        address liquidationEngine;
        address owner;
        uint256 chainId;
    }

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        // For local devnet the deployer fills owner and operator (matching engine hot key).
        // Phase 4 wires a real LiquidationEngine contract; for now we pin the liquidation role
        // to the deployer so test scripts can call applyFill via that path if needed.
        address owner = deployer;
        address operator = deployer;
        address liquidation = deployer;

        vm.startBroadcast(deployerPk);

        MockUSDC usdc = new MockUSDC();
        MockOracle oracle = new MockOracle(owner);
        MarketRegistry markets = new MarketRegistry(owner);
        PositionRegistry positionRegistry =
            new PositionRegistry(owner, IMarketRegistry(address(markets)), IOracleAdapter(address(oracle)));

        // SettlementEngine is deployed two steps after the vault, so its address is computed
        // ahead of time via CREATE nonce arithmetic and passed into the vault constructor.
        // After deploying the engine we verify the predicted address matches.
        uint64 nonce = vm.getNonce(deployer);
        address futureEngine = vm.computeCreateAddress(deployer, nonce + 1);

        CollateralVault vault = new CollateralVault(
            IERC20(address(usdc)), IPositionRegistry(address(positionRegistry)), futureEngine, liquidation
        );
        SettlementEngine engine = new SettlementEngine(
            owner, operator, IPositionRegistry(address(positionRegistry)), ICollateralVault(address(vault))
        );
        require(address(engine) == futureEngine, "engine address mismatch");

        positionRegistry.setWiring(ICollateralVault(address(vault)), address(engine), liquidation);

        SyntheticCounterparty counterparty =
            new SyntheticCounterparty(owner, address(engine), address(usdc), address(vault));
        engine.setFillHook(address(counterparty));
        _seedCounterpartyCaps(counterparty);

        _listMarkets(markets);
        _seedPrices(oracle);

        vm.stopBroadcast();

        Deployments memory d = Deployments({
            mockUsdc: address(usdc),
            mockOracle: address(oracle),
            marketRegistry: address(markets),
            positionRegistry: address(positionRegistry),
            collateralVault: address(vault),
            settlementEngine: address(engine),
            syntheticCounterparty: address(counterparty),
            liquidationEngine: liquidation,
            owner: owner,
            chainId: block.chainid
        });

        _writeDeployments(d);
        _logDeployments(d);
    }

    function _listMarkets(MarketRegistry markets) internal {
        // v1: BTC-USD, ETH-USD, SOL-USD. Risk params from PRD v1.1 section 11.
        markets.listMarket(
            keccak256("btc-usd"),
            IPositionRegistry.MarketParams({
                imRatioBps: 500,
                mmRatioBps: 250,
                liqBonusBps: 100,
                takerFeeBps: 5,
                makerRebateBps: -2,
                active: true
            })
        );
        markets.listMarket(
            keccak256("eth-usd"),
            IPositionRegistry.MarketParams({
                imRatioBps: 500,
                mmRatioBps: 250,
                liqBonusBps: 100,
                takerFeeBps: 5,
                makerRebateBps: -2,
                active: true
            })
        );
        markets.listMarket(
            keccak256("sol-usd"),
            IPositionRegistry.MarketParams({
                imRatioBps: 1_000,
                mmRatioBps: 500,
                liqBonusBps: 150,
                takerFeeBps: 7,
                makerRebateBps: -2,
                active: true
            })
        );
    }

    /// @dev Phase 7 caps are deliberately generous on devnet; production caps come from the
    ///      counterparty risk doc and would be tuned per-market. 100 BTC / 1000 ETH /
    ///      50_000 SOL of net exposure is more than the maker bot ever needs locally.
    function _seedCounterpartyCaps(SyntheticCounterparty counterparty) internal {
        counterparty.setCap(keccak256("btc-usd"), 100e18);
        counterparty.setCap(keccak256("eth-usd"), 1_000e18);
        counterparty.setCap(keccak256("sol-usd"), 50_000e18);
    }

    function _seedPrices(MockOracle oracle) internal {
        bytes32[] memory ids = new bytes32[](3);
        uint256[] memory prices = new uint256[](3);
        ids[0] = keccak256("btc-usd");
        prices[0] = 100_000e18;
        ids[1] = keccak256("eth-usd");
        prices[1] = 3_500e18;
        ids[2] = keccak256("sol-usd");
        prices[2] = 200e18;
        oracle.setPrices(ids, prices);
    }

    function _writeDeployments(Deployments memory d) internal {
        string memory root = vm.projectRoot();
        string memory dir = string.concat(root, "/deployments");
        vm.createDir(dir, true);
        string memory file = string.concat(dir, "/anvil.json");

        string memory json = "deployments";
        vm.serializeAddress(json, "MockUSDC", d.mockUsdc);
        vm.serializeAddress(json, "MockOracle", d.mockOracle);
        vm.serializeAddress(json, "MarketRegistry", d.marketRegistry);
        vm.serializeAddress(json, "PositionRegistry", d.positionRegistry);
        vm.serializeAddress(json, "CollateralVault", d.collateralVault);
        vm.serializeAddress(json, "SettlementEngine", d.settlementEngine);
        vm.serializeAddress(json, "SyntheticCounterparty", d.syntheticCounterparty);
        vm.serializeAddress(json, "LiquidationEngine", d.liquidationEngine);
        vm.serializeAddress(json, "owner", d.owner);
        string memory out = vm.serializeUint(json, "chainId", d.chainId);

        vm.writeJson(out, file);
    }

    function _logDeployments(Deployments memory d) internal pure {
        console2.log("MockUSDC         ", d.mockUsdc);
        console2.log("MockOracle       ", d.mockOracle);
        console2.log("MarketRegistry   ", d.marketRegistry);
        console2.log("PositionRegistry ", d.positionRegistry);
        console2.log("CollateralVault  ", d.collateralVault);
        console2.log("SettlementEngine ", d.settlementEngine);
        console2.log("SyntheticCpty    ", d.syntheticCounterparty);
    }
}
