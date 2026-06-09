# Final Implementation Plan

## Status
- This is the current final plan based on the strict audit.
- It supersedes softer roadmap ordering in implementation priority.
- Core rule: Safety Gate first. Strategy second. ML last.
- Live trading is NO-GO until all Critical items in this document are complete.

## Target Outcome
- Run a stable MT5 EA on AXIORY with automated safety controls.
- Keep human work limited to exception approval and priority changes.
- Let agents search, implement candidates, analyze reports, and reject unsafe variants automatically.
- Prevent ruin before chasing profit.

## Non-Negotiable Rules
- Do not call external LLM, web, or slow APIs inside `OnTick()`.
- Do not deploy a model, strategy, or parameter set directly from research output.
- Do not use raw OHLC as an ONNX model input.
- Do not treat B1 breakout as a production strategy until it passes gates.
- Do not run multiple strategy signals on one live account until each passes standalone validation.
- Do not sync a single EA file to MT5 when dependent `Include/*.mqh` files changed.
- Do not overwrite existing uncommitted changes unless explicitly instructed.

## Current Known State
- `src/Expert_Main.mq5` runs breakout-only validation flow.
- `src/Include/TradeLogic.mqh` has a local uncommitted one-bar-confirmation breakout change. Treat it as a candidate, not as validated production code.
- `src/Include/RiskManagement.mqh` in git still uses `tick_value / tick_size` style loss estimation in `CalculateLotFromSLDistance(...)`. This is unsafe for XAUUSD + JPY account behavior and must be fixed first.
- `STRATEGY_ADOPTION_PLAN.md` defines the adopted strategy set, but this document defines implementation order.
- MT5 compile/backtest still requires `wag-dell` GUI/RDP unless a separate automation path is implemented.

## Severity Gates

### Critical Gate
The project cannot move to paper or live trading until all are complete:
- `RiskManagement.mqh` uses `OrderCalcProfit(...)` for loss-per-lot estimation.
- Risk version is printed in tester logs on init or first lot calculation.
- Drawdown state can block new entries deterministically.
- Backtest report/log parser can produce pass/fail JSON.
- B1 six-month and two-year backtests are analyzed by the parser.
- Stale include deployment is prevented by process or script.

### High Gate
The project cannot add B2/B8 production candidates until all are complete:
- B2 uses confirmed bars only, never shift `0`.
- ONNX candidates use normalized features only.
- All-Buy / All-Sell / Hold-only model collapse is automatically rejected.
- Candidate model promotion cannot overwrite production artifacts directly.

## Implementation Order

## Phase 0: Repository and Deployment Hygiene

### Goal
Prevent accidental commits, stale include bugs, and partial MT5 deployment.

### Files
- `src/Expert_Main.mq5`
- `src/Include/*.mqh`
- `backtest/`
- future: `src/Scripts/deploy_mt5_bundle.*`

### Steps
1. Before any code change, run `rtk git status --short`.
2. If `src/Include/TradeLogic.mqh` has the local one-bar-confirmation diff, do not revert it and do not mix it into unrelated commits.
3. Define EA bundle as:
   - `src/Expert_Main.mq5`
   - `src/Include/TradeLogic.mqh`
   - `src/Include/RiskManagement.mqh`
   - `src/Include/DataFeed.mqh`
4. Any deployment to `wag-dell` must copy the full bundle, not a single file.
5. After deployment, verify by searching the deployed file contents for expected markers such as risk version and strategy version.

### Acceptance Criteria
- No commit contains unrelated local EA experiments.
- Deployed MT5 files and git files are intentionally synchronized or intentionally documented as different.
- Tester log contains the expected version marker after compile.

## Phase 1: RiskManager Safety Hardening

### Goal
Fix the highest-risk money-management path before optimizing strategy logic.

### Primary File
- `src/Include/RiskManagement.mqh`

### Required Changes
1. Add a risk version marker.
   - Suggested value: `RISK_V3_ORDER_CALC_PROFIT`.
   - Print it once during initialization or first lot calculation.
2. Replace `CalculateLotFromSLDistance(...)` loss estimation.
3. Add an internal helper to estimate loss per 1.0 lot using `OrderCalcProfit(...)`.
4. Keep margin capping using `OrderCalcMargin(...)`.
5. Return `0.0` on any ambiguous or invalid state.

### Exact MQL5 Logic
Use this behavior, not `tick_value / tick_size`:

```cpp
double EstimateLossPerLot(ENUM_ORDER_TYPE type, double entry_price, double sl_distance_price)
  {
   if(sl_distance_price <= 0.0)
      return 0.0;

   double sl_price = (type == ORDER_TYPE_BUY)
                     ? entry_price - sl_distance_price
                     : entry_price + sl_distance_price;

   double profit = 0.0;
   if(!OrderCalcProfit(type, _Symbol, 1.0, entry_price, sl_price, profit))
      return 0.0;

   double loss = MathAbs(profit);
   if(loss <= 0.0)
      return 0.0;

   return loss;
  }
```

Then `CalculateLotFromSLDistance(...)` must:
- Read equity and free margin.
- Compute `risk_amount = equity * m_risk_per_trade_pct`.
- Compute `loss_per_lot = EstimateLossPerLot(...)`.
- Compute raw lot as `risk_amount / loss_per_lot`.
- Normalize down to broker step.
- Apply daily drawdown reduction.
- Loop downward with `OrderCalcMargin(...)` until margin fits under `free_margin * 0.95`.
- Return `0.0` if no safe lot exists.

### Do Not
- Do not use `SYMBOL_TRADE_TICK_VALUE / SYMBOL_TRADE_TICK_SIZE` as the primary loss calculation.
- Do not force minimum lot if the calculated risk is below minimum and unsafe.
- Do not increase lot to satisfy broker minimum when risk would exceed target.

### Acceptance Criteria
- Compile succeeds in MetaEditor.
- Tester logs show `RISK_V3_ORDER_CALC_PROFIT`.
- No `No money` error in baseline backtest.
- No lot spike comparable to the previous unsafe `1.37 / 0.47` behavior.
- Calculated lots remain consistent with `m_risk_per_trade_pct = 0.005` and actual SL distance.

## Phase 2: Operational Stop State

### Goal
Make drawdown limits operational, not just advisory returns.

### Primary File
- `src/Include/RiskManagement.mqh`

### Required Behavior
- Daily drawdown breach: block new entries and optionally reduce lot before breach.
- Monthly drawdown breach: block new entries for the strategy until monthly reset.
- Global drawdown breach: block all new entries and trigger emergency close for current symbol unless explicitly disabled by input.
- Existing positions should keep SL/TP on daily and monthly stops.
- Global stop may close current-symbol positions using a dedicated method.

### Suggested API
Add a simple state enum or integer state:

```cpp
enum ERiskState
  {
   RISK_STATE_OK = 0,
   RISK_STATE_DAILY_STOP = 1,
   RISK_STATE_MONTHLY_STOP = 2,
   RISK_STATE_GLOBAL_STOP = 3
  };
```

Add methods:
- `ERiskState GetRiskState()`
- `bool CanOpenNewPosition()`
- `bool IsGlobalStop()`
- `bool CloseAllPositionsForCurrentSymbol()`

### Expert_Main Integration
In `src/Expert_Main.mq5`:
- Replace duplicated `IsHealthy()` / `CanEnter()` checks with one state-driven decision.
- If global stop is active, call close method once and return.
- If daily/monthly stop is active, return before signal evaluation if possible.

### Acceptance Criteria
- Daily DD does not allow new positions.
- Monthly DD does not allow new positions.
- Global DD does not allow new positions and attempts emergency close once per position.
- Alerts are printed once per state transition, not every tick.

## Phase 3: Executable Backtest Gate

### Goal
Convert document-level gates into a parser that blocks unsafe candidates.

### Files To Add
- `backtest/gate_config.json`
- `src/Scripts/analyze_mt5_report.py`
- `backtest/results/.gitkeep` if the directory does not exist

### Parser Requirements
The parser must accept:

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --report "C:/Users/wag/Downloads/ReportTester-20052974.html" \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Tester/.../logs/latest.log" \
  --scenario breakout_xauusd_6m \
  --config backtest/gate_config.json \
  --out backtest/results/breakout_xauusd_6m.json
```

### Encoding
- MT5 HTML reports may be UTF-16LE.
- The parser must try UTF-16LE first, then UTF-8.

### Metrics To Extract
- net profit
- profit factor
- Sharpe ratio
- balance drawdown absolute and percent
- equity drawdown absolute and percent
- total trades
- win count and loss count
- win rate
- largest lot if available from log
- margin errors from log
- `No money` errors from log
- risk version marker from log

### Gate Config
Use positive drawdown magnitude in config to avoid sign mistakes:

```json
{
  "default": {
    "min_sharpe": 1.5,
    "min_profit_factor": 1.2,
    "max_drawdown_pct": 15.0,
    "min_trades": 50,
    "reject_no_money": true,
    "reject_margin_error": true,
    "required_log_markers": ["RISK_V3_ORDER_CALC_PROFIT"]
  }
}
```

### Output JSON
The output must include:
- `scenario`
- `passed`
- `metrics`
- `failed_rules`
- `warnings`
- `report_path`
- `log_path`
- `created_at`

### Acceptance Criteria
- Parser returns non-zero exit code on failed gate.
- Parser rejects missing `RISK_V3_ORDER_CALC_PROFIT` marker.
- Parser rejects `No money` and margin errors.
- Parser produces stable JSON usable by agents.

## Phase 4: B1 Breakout Validation

### Goal
Validate B1 as a strategy candidate only after risk and gate are fixed.

### Files
- `src/Expert_Main.mq5`
- `src/Include/TradeLogic.mqh`
- `backtest/test_scenarios.json`

### Required Scenarios
Add or verify scenarios:
- `breakout_xauusd_3m_baseline`
- `breakout_xauusd_6m_baseline`
- `breakout_xauusd_2y_baseline`
- `breakout_xauusd_6m_one_bar_confirm`
- `breakout_xauusd_2y_one_bar_confirm`

### Standard Inputs
- `InpUseH1EMAFilter = false`
- `InpBreakoutLookbackBars = 10`
- `InpBreakoutATRMin = 1.5`
- `InpStopLossATRMultiplier = 1.5`
- `InpTakeProfitATRMultiplier = 3.0`
- `InpSessionStartHour = 12`
- `InpSessionEndHour = 24`

### Acceptance Criteria
- Six-month and two-year results pass the executable gate.
- If B1 fails gate, keep it as infrastructure test only.
- Do not tune parameters on test data without a separate out-of-sample split.

## Phase 5: B2 Pullback Candidate

### Goal
Add B2 only after B1 risk/gate foundation is stable.

### Primary File
- `src/Include/TradeLogic.mqh`

### Required Fixes Before Testing
Current pullback placeholder uses shift `0`; fix this before any backtest.

Replace all indicator `CopyBuffer(..., 0, 0, 1, values)` in pullback logic with confirmed-bar reads:
- H4 EMA: shift `1`
- D1 EMA: shift `1`
- M15 RSI: shift `1`
- M15 ATR for SL/TP: shift `1`

### Design Rules
- `CPullbackSignal_SP500` must not place orders.
- It returns a signal only.
- RiskManager decides lot and execution.
- It is disabled by default until standalone gate passes.

### Acceptance Criteria
- SP500 pullback standalone backtest passes gate.
- No shift `0` references remain in B2 signal calculations.
- B2 does not interact with XAUUSD breakout until standalone pass is documented.

## Phase 6: B8 Normalized ONNX Candidate Pipeline

### Goal
Build the model validation system before using model outputs in EA.

### Files To Add
- `src/Scripts/features.py`
- `src/Scripts/train_onnx_candidate.py`
- `src/Scripts/evaluate_candidate.py`
- `src/Scripts/model_registry.py`
- `models/candidates/.gitkeep`
- `models/production/.gitkeep`

### Feature Rules
Allowed features:
- log returns
- ATR-normalized returns
- RSI
- MACD normalized values
- HMA slope normalized by ATR
- session/time features encoded without future leakage
- volatility regime features from confirmed history only

Forbidden features:
- raw close price
- raw OHLC window as direct model input
- future bars
- labels derived from overlapping future windows without leakage controls

### Model Rules
- Export ONNX with opset 17.
- Candidate model artifact name must include timestamp and git commit hash.
- Production model must never be overwritten in place.
- Registry must record training range, validation range, feature version, metrics, and gate result.

### Collapse Rejection
Reject candidate if:
- Buy probability dominates almost every sample.
- Sell probability dominates almost every sample.
- Hold probability dominates almost every sample.
- Class distribution diverges sharply between train and validation.
- Validation Sharpe and PF do not pass gate.

### EA Integration Rule
- Do not enable `CMLModel_Universal` in `Expert_Main.mq5` until the candidate pipeline and registry exist.
- ONNX output can be used as a filter before it is used as a primary signal.

## Phase 7: B7 Research-Agent Hypothesis Cards

### Goal
Use research automation without allowing it to deploy code directly.

### Files To Add
- `research/hypotheses/.gitkeep`
- `research/HYPOTHESIS_TEMPLATE.md`

### Template Fields
- `id`
- `source_url`
- `instrument`
- `strategy_family`
- `hypothesis`
- `entry_rule`
- `exit_rule`
- `risk_rule`
- `required_data`
- `expected_edge`
- `failure_modes`
- `implementation_complexity`
- `safety_review`
- `decision`: `reject | research | implement_candidate`

### Acceptance Criteria
- Research output cannot directly modify EA files.
- Each implemented strategy candidate references a hypothesis card.
- Cards with missing risk rule are rejected.

## Phase 8: Gated Continuous Learning

### Goal
Convert B6 from dangerous blind deployment into safe candidate generation.

### State Machine
Use this promotion chain:

```text
hypothesis
  -> implemented_candidate
  -> backtest_passed
  -> walk_forward_passed
  -> shadow_passed
  -> paper_passed
  -> production_approved
```

### Hard Rules
- Automated jobs may create `candidate` artifacts.
- Automated jobs may reject candidates.
- Automated jobs may not overwrite production.
- Automated jobs may not enable a live strategy flag.
- Production approval requires a recorded gate result and rollback artifact.

### Acceptance Criteria
- Candidate promotion is impossible without gate JSON.
- Production artifact has previous version available for rollback.
- Failed candidate remains archived with rejection reason.

## Commit Boundaries

### Commit 1
`fix(trade): harden risk sizing with order profit estimates`
- Only `RiskManagement.mqh` and minimal `Expert_Main.mq5` integration.

### Commit 2
`test(trade): add executable mt5 report gate`
- Parser, config, result directory.

### Commit 3
`test(trade): define breakout validation scenarios`
- Backtest scenarios and documentation only.

### Commit 4
`fix(trade): enforce confirmed bars in pullback signal`
- B2 confirmed-bar fix only.

### Commit 5
`feat(trade): add normalized onnx candidate pipeline`
- Python candidate pipeline, no EA production enablement.

### Commit 6
`docs(trade): add research hypothesis workflow`
- Research card workflow.

## Verification Commands

### Git
```bash
rtk git status --short
rtk git diff --stat
rtk git diff --cached --stat
```

### TypeScript Repo Hooks
Run from repository root only for repo hook parity if needed. The pre-push hook currently runs typecheck automatically:

```bash
env PATH="/Users/wag/.bun/bin:${PATH}" rtk git push takeshi dev
```

### MT5
- Compile on `wag-dell` MetaEditor.
- Run Strategy Tester with `1 minute OHLC` for comparable results.
- Export report to `C:\Users\wag\Downloads\ReportTester-20052974.html` or scenario-specific path.
- Analyze with parser after Phase 3 exists.

## Implementation Stop Conditions
- Stop if risk lot calculation cannot be verified in logs.
- Stop if report parser cannot parse MT5 HTML deterministically.
- Stop if B1 still fails six-month and two-year gates after safety fixes.
- Stop if B2 requires shift `0` to pass.
- Stop if ONNX candidate requires raw OHLC to pass.
- Stop if an automated job attempts production overwrite.

## Final Decision
- The final current plan is approved for development only.
- Live trading remains NO-GO.
- Next implementation task is Phase 1: RiskManager Safety Hardening.
