# Margin Math — Worked Examples (v1.1)

Authoritative semantics for every position calculation in Perplex. Numbers shown in human-readable form; on-chain values are 1e18-scaled.

Audience: Solidity dev writing `PositionRegistry.sol`, Rust dev writing matching margin pre-check, FE dev rendering health factor and liquidation price.

These examples become Foundry differential test fixtures: Rust math output must equal Solidity math output bit-for-bit.

---

## 0. Conventions

| Symbol | Meaning | Sign convention |
| ------ | ------- | --------------- |
| `size` | Net position size in base asset | positive = long, negative = short, zero = no position |
| `entryPrice` | Volume-weighted average entry price | always positive |
| `markPrice` | Current oracle price (mark) | always positive |
| `notional` | Position size in USDC at mark | `\|size\| * markPrice` |
| `IM` | Initial Margin required | `notional * imRatio` |
| `MM` | Maintenance Margin required | `notional * mmRatio` |
| `uPnL` | Unrealised PnL in USDC | signed, can be negative |
| `rPnL` | Realised PnL in USDC (cumulative) | signed |
| `collateral` | USDC in CollateralVault balance | non-negative |
| `equity` | `collateral + uPnL` | signed |
| `freeCollateral` | `equity - ΣIM_open_positions` | signed; negative = no new orders |
| `healthFactor` | `equity / ΣMM_open_positions` | dimensionless; `< 1.0` = liquidatable |

Market params used in examples:
- BTC-USD: `imRatio = 5%`, `mmRatio = 2.5%`, `liqBonus = 1.0%`, max leverage 20x
- ETH-USD: `imRatio = 5%`, `mmRatio = 2.5%`, `liqBonus = 1.0%`, max leverage 20x
- SOL-USD: `imRatio = 10%`, `mmRatio = 5%`, `liqBonus = 1.5%`, max leverage 10x

---

## 1. VWAP Entry Price — Add to Position

Alice opens a long. Then adds more in the same direction. Entry price is the size-weighted average of all opening fills.

### Step 1 — first fill
- Buys 0.1 BTC at $100,000
- `size = +0.1`
- `entryPrice = 100,000`

### Step 2 — adds 0.05 BTC at $98,000

Formula on adding to position (same side):
```
oldNotional = |oldSize| * entryPrice         = 0.10 * 100,000 = 10,000
addNotional = |sizeDelta| * fillPrice        = 0.05 *  98,000 =  4,900
newSize     = oldSize + sizeDelta            = 0.10 + 0.05    = 0.15
newEntry    = (oldNotional + addNotional) / |newSize|
            = (10,000 + 4,900) / 0.15
            = 99,333.333...
```

Result: `size = +0.15`, `entryPrice = 99,333.33`.

Solidity (1e18-scaled, line from `applyFill`):
```solidity
if ((p.size > 0) == (sizeDelta > 0)) {
    uint256 oldNotional = uint256(_abs(p.size)) * p.entryPriceX18;
    uint256 addNotional = uint256(_abs(sizeDelta)) * priceX18;
    p.entryPriceX18 = (oldNotional + addNotional) / uint256(_abs(newSize));
}
```

Edge cases:
- Same side, both positive sizes → above branch
- Same side, both negative sizes (adding to short) → same branch (signs match)
- Order of operations matters: multiply before divide to preserve precision

---

## 2. VWAP Entry Price — Partial Close (Opposite Fill)

Alice has `size = +0.15` long at `entryPrice = 99,333.33`. She sells 0.05 at mark $100,500.

Closing fill DOES NOT change entry price. It realises PnL on the closed portion and leaves remaining position at the same entry.

```
sizeDelta   = -0.05  (sell shrinks long)
newSize     = 0.15 + (-0.05) = +0.10
entryPrice  = 99,333.33  (unchanged)

closedQty   = 0.05
realisedPnL = closedQty * (fillPrice - entryPrice)
            = 0.05 * (100,500 - 99,333.33)
            = 0.05 * 1,166.67
            = 58.33  USDC (positive = profit)
```

For a short being partially covered: `realisedPnL = closedQty * (entryPrice - fillPrice)`.

Generalised:
```
realisedPnL = closedQty * (fillPrice - entryPrice) * sign(oldSize)
```
where `sign(+) = +1, sign(-) = -1`.

---

## 3. VWAP Entry Price — Position Flip

Alice has `size = +0.10` long at `entryPrice = 99,333.33`. She sells 0.15 at $100,000.

```
sizeDelta = -0.15
newSize   = +0.10 + (-0.15) = -0.05   (flipped to short)
```

Two phases:
1. **Close the +0.10 long** at $100,000:
   ```
   closedQty   = 0.10
   realisedPnL = 0.10 * (100,000 - 99,333.33)
               = 66.67 USDC
   ```
2. **Open a new -0.05 short** at $100,000:
   ```
   newSize     = -0.05
   entryPrice  = 100,000   (reset to the flip-fill price)
   ```

The new position's entry price is the fill price of the flipping leg, not the old entry. Critical for accuracy.

Solidity sketch:
```solidity
if (sign(p.size) != sign(newSize)) {
    // first fully close old position
    realised += int256(_abs(p.size)) * (int256(priceX18) - int256(p.entryPriceX18)) * sign(p.size);
    // then open new in opposite direction
    p.entryPriceX18 = priceX18;
}
p.size = newSize;
```

---

## 4. Unrealised PnL

Pure mark-to-market on the open size.

```
uPnL = size * (markPrice - entryPrice)
```

`size` is signed, so the formula auto-handles longs and shorts:

| Position | size | entryPrice | markPrice | size * (mark - entry) |
| -------- | ---- | ---------- | --------- | --------------------- |
| Long winning  | +0.10 |  99,333.33 | 105,000 | +566.67 USDC |
| Long losing   | +0.10 |  99,333.33 |  95,000 | -433.33 USDC |
| Short winning | -0.10 | 100,000    |  95,000 | +500.00 USDC |
| Short losing  | -0.10 | 100,000    | 105,000 | -500.00 USDC |

---

## 5. Health Factor and Liquidation

### Setup
Alice has 1,500 USDC in CollateralVault. Open position: `size = +0.10 BTC`, `entryPrice = 100,000`. Current mark `$98,000`.

```
notional    = |0.10| * 98,000 = 9,800 USDC
IM_required = 9,800 * 5%  = 490 USDC
MM_required = 9,800 * 2.5% = 245 USDC
uPnL        = 0.10 * (98,000 - 100,000) = -200 USDC

equity         = collateral + uPnL = 1,500 + (-200) = 1,300 USDC
freeCollateral = equity - IM       = 1,300 - 490    = 810 USDC
healthFactor   = equity / MM       = 1,300 / 245    = 5.306
```

`healthFactor >> 1.0` — position is very safe.

### Liquidation Price (Long)

Find the mark price `P*` at which `equity == MM_required`.

```
equity         = collateral + size * (P* - entryPrice)
MM_required    = |size| * P* * mmRatio

collateral + size * (P* - entryPrice) = |size| * P* * mmRatio
```

For a long (`size > 0`, so `|size| = size`):
```
collateral + size * P* - size * entryPrice = size * P* * mmRatio
collateral - size * entryPrice              = size * P* * (mmRatio - 1)
P* = (collateral - size * entryPrice) / (size * (mmRatio - 1))
   = (size * entryPrice - collateral) / (size * (1 - mmRatio))
```

Plug numbers:
```
P* = (0.10 * 100,000 - 1,500) / (0.10 * (1 - 0.025))
   = (10,000 - 1,500) / (0.10 * 0.975)
   = 8,500 / 0.0975
   = 87,179.49
```

So Alice gets liquidated at mark `$87,179.49`. Useful for FE liquidation price display.

For a short (`size < 0`):
```
P* = (|size| * entryPrice + collateral) / (|size| * (1 + mmRatio))
```

Caveat: this single-position formula assumes only one open market. With multiple markets, liquidation price per market is computed holding all other positions at their current mark — FE may approximate this for display.

---

## 6. Withdrawal Safety — `isWithdrawSafe`

Authoritative on-chain check before any `withdraw()` returns USDC.

Definition:
> A withdrawal of amount `W` is safe iff the post-withdrawal equity still covers ALL initial margin requirements across open positions.

```
isWithdrawSafe(user, W) :=
  (collateral - W) + Σ_m uPnL_m  >=  Σ_m IM_required_m
```

Note `IM` not `MM` — withdrawal uses the *stricter* threshold so the user can't immediately wedge themselves at the liquidation edge.

### Scenario 1 — Safe withdrawal
Alice: `collateral = 1,500`, one position, `uPnL = -200`, `IM_required = 490`. Wants to withdraw `W = 500`.
```
(1,500 - 500) + (-200) = 800
800 >= 490  →  SAFE
```

### Scenario 2 — Blocked withdrawal
Same Alice, but wants `W = 1,300`.
```
(1,500 - 1,300) + (-200) = 0
0 >= 490  →  FALSE  →  revert
```

### Scenario 3 — Two-position safe check
Alice has 5,000 USDC. Positions:
- BTC long: `IM = 490`, `uPnL = -200`
- ETH short: `IM = 300`, `uPnL = +150`

```
ΣIM = 790, ΣuPnL = -50
(5,000 - W) + (-50) >= 790
W <= 5,000 - 50 - 790 = 4,160
```

She can safely withdraw up to `4,160 USDC`.

Solidity sketch:
```solidity
function isWithdrawSafe(address user, uint256 amount) external view returns (bool) {
    uint256 bal = vault.balances(user);
    if (bal < amount) return false;
    int256 totalUPnL = 0;
    uint256 totalIM = 0;
    for (uint i; i < userMarkets[user].length; ++i) {
        bytes32 mid = userMarkets[user][i];
        uint256 px = oracle.priceX18(mid);
        totalUPnL += unrealisedPnl(user, mid, px);
        totalIM   += initialMarginRequired(user, mid, px);
    }
    int256 postEquity = int256(bal - amount) + totalUPnL;
    return postEquity >= int256(totalIM);
}
```

---

## 7. Funding Rate — Lazy Settlement

Per market, the protocol maintains a global `cumulativeFundingIndex` updated every 8 hours. Per-position math is "lazy" — funding is only applied when the user next touches the position.

### Definitions

```
fundingRate = (mark_premium / 24)     // 8h period, scaled to per-period bps
cumulativeFundingIndex_t = cumulativeFundingIndex_{t-1} + (fundingRate_t * markPrice_avg)
```

Per-position stored snapshot at last touch: `position.cumulativeFunding`.

On any subsequent fill or settlement event for that position:
```
fundingDelta = (cumulativeFundingIndex_current - position.cumulativeFunding) * position.size
```

`fundingDelta > 0` means longs paid shorts (premium positive), so:
- If `position.size > 0` (long), `realisedPnL -= |fundingDelta|`
- If `position.size < 0` (short), `realisedPnL += |fundingDelta|`

Equivalently with signed math:
```
realisedPnL -= fundingDelta    // (longs pay when index up, shorts receive)
```

Then snapshot: `position.cumulativeFunding = cumulativeFundingIndex_current`.

### Worked example

State at time T0:
- `cumulativeFundingIndex = 1,000` (1e18-scaled)
- Alice long `size = +0.10 BTC`, snapshot `cumulativeFunding = 800`

At T1 the index advances to `1,200`. Alice does a settling action (open another fill, or someone touches her position):

```
fundingDelta = (1,200 - 800) * 0.10 = 40 USDC
size > 0 (long), so longs pay → Alice realises -40 USDC
```

Her snapshot updates to `1,200`.

The opposite side of the trade (shorts in aggregate) gets credited equivalently — but lazily, only when each short trader's position is next touched. The protocol's invariant is that the SUM of funding deltas across all positions in a market is zero (longs and shorts net to zero); this is enforced by computing index from `mark_premium` symmetrically.

---

## 8. Auto-Deleveraging (ADL) — Bad Debt Socialisation

ADL is the last line of defense when a liquidation leaves negative equity AND the insurance fund cannot cover it.

### Trigger

```
shortfall = MM_required - equity_at_liquidation
if shortfall > insuranceFund.balance:
    enter_ADL_for_remainder
```

### Algorithm (pseudocode)

```
function adl(market, shortfall):
    # 1. Take whatever insurance fund has
    drained = min(insuranceFund.balance, shortfall)
    insuranceFund.balance -= drained
    shortfall -= drained
    if shortfall == 0: return

    # 2. Build ranked list of opposite-side winning positions
    #    Rank by: pnl_pct * leverage (more profit, more leverage = first ADL'd)
    underwaterSide = position_being_liquidated.side   # the side we're forcibly closing
    counterSide    = opposite(underwaterSide)
    candidates = [
        p for p in market.positions if p.side == counterSide and uPnL(p) > 0
    ]
    rank = lambda p: (uPnL(p) / margin(p)) * leverage(p)
    candidates.sort(by=rank, descending=True)

    # 3. Walk top-of-rank, deleverage just enough to cover shortfall
    remaining = shortfall
    for p in candidates:
        if remaining == 0: break
        coverable = uPnL(p)        # amount we can extract from this trader
        take = min(coverable, remaining)
        # Forcibly close `take / markPrice` of size at markPrice
        sizeToClose = take / markPrice
        force_close(p, sizeToClose, markPrice)
        # p realises uPnL on the closed portion but receives no payout; payout goes to bad debt
        socialise(take)
        remaining -= take

    assert remaining == 0    # math guarantees ADL covers any solvent market
```

### Worked example

Market: BTC-USD. Mark crash to $80k.

Underwater: Bob, long 1.0 BTC at entry $100k. Collateral $5k.
```
notional = 1.0 * 80,000 = 80,000
uPnL     = 1.0 * (80,000 - 100,000) = -20,000
equity   = 5,000 + (-20,000) = -15,000
MM_req   = 80,000 * 2.5% = 2,000
shortfall = MM_req - equity = 2,000 - (-15,000) = 17,000  USDC of bad debt
```

(In practice, the liquidator first force-closes Bob's position at mark, bonus from any residual equity. Assume here residual is gone — true bad debt = 17,000.)

Insurance fund has 10,000 → covers 10,000. Remaining 7,000 socialised via ADL.

Counter-side winners ranked. Top candidate: Carla, short 0.5 BTC at entry $95k.
```
uPnL_carla = -0.5 * (80,000 - 95,000) = +7,500
```
Carla's full $7,500 profit absorbs the $7,000 shortfall. Force-close `7,000 / 80,000 = 0.0875 BTC` of her short at mark — she keeps `0.4125 BTC` short at original entry; the closed portion's $7,000 profit goes to bad debt, not to her vault.

### Critical invariants
- ADL only deleverages **profitable opposite-side** positions
- ADL only takes profit from the closed portion, never touches principal
- ADL is *visible* — every ADL event emits `event AdlExecuted(market, victim, sizeClosed, valueTaken)` so traders can audit
- Frontend MUST show "ADL Rank" to every user with open positions (e.g. "you are in the top 5% of ADL targets")

---

## 9. Edge Cases

### Zero-size positions
After a full close, `positions[user][market]` must be `delete`d (not left as `size=0` with stale entry). Else funding-index snapshot drift causes wrong PnL on next open in that market.

### Self-trade
Two orders from the same wallet matched → reject before fill generation. Configurable: `cancel-both` (cancel both orders) or `cancel-newest` (keep older, cancel newer).

### Rounding
On-chain math uses integer arithmetic with 1e18 scaling. Always multiply before divide:
```solidity
// BAD: precision loss
uint256 share = (amount / total) * stake;
// GOOD: full precision
uint256 share = (amount * stake) / total;
```

### Negative remaining qty
Guard at the matching engine. Property test: after any sequence of fills, `qty - sum(fills) >= 0` for every order.

### Mark vs Index price
- `markPrice` (oracle, Pyth) drives PnL and liquidation
- `indexPrice` (oracle median, also Pyth) used for funding-rate computation (premium = mark - index)

In v1 both can be the same Pyth feed (Pyth provides both spot and derivative pricing for major assets). Document the choice; do NOT silently swap one for the other in tests.

---

## 10. Test Fixture Generation

Every example in this document becomes a Foundry differential test case:

```solidity
// contracts/test/differential/MarginMath.t.sol
function testFixture_Section1_VwapAdd() public {
    PositionRegistry.applyFill(alice, BTC, +0.1e18, 100_000e18);
    PositionRegistry.applyFill(alice, BTC, +0.05e18, 98_000e18);
    Position memory p = registry.positions(alice, BTC);
    assertEq(p.size, 0.15e18);
    assertApproxEqRel(p.entryPriceX18, 99_333_333e15, 1e12);  // 1e-6 tolerance
}
```

Mirror in Rust `perplex-core::margin` module with identical inputs; CI asserts equality.
