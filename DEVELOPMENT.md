# Development Workflow

## Positioning

- This document is the operational entry point for working in `opencode-trade`.
- The canonical trading plan is [EA_TRADING_PLAN.md](./EA_TRADING_PLAN.md).
- Sentinel-specific work is defined in [SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md](./SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md).
- Remote MT5 compile and smoke procedures live in [REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md](./REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md).
- Current tool split:
  - `opencode` handles the main development stream, implementation-heavy changes, CI repair, and active PR work.
  - `codex` currently handles supporting work such as documentation cleanup, README maintenance, design/spec edits, branch hygiene, and focused audits.
- This split is intentionally lightweight and may change later. Treat it as a current working convention, not a hard architectural boundary.

When documents conflict, prefer:

1. `EA_TRADING_PLAN.md`
2. `SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md`
3. `STRICT_REMEDIATION_PLAN.md`
4. this file

## Repository Setup

Primary fork:

```bash
git clone https://github.com/TakeshiSawaguchi/opencode-trade.git
cd opencode-trade
```

Optional upstream remote for comparison only:

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git remote -v
```

Do not assume Codeberg paths or remote names from older notes. Use the actual remote configuration of the current checkout.

## Branch Model

- Keep `dev` as the shared mainline.
- Use `feature/...` branches for implementation work that is actively being developed in `opencode`.
- Use short-lived `docs/...` or `fix/...` branches for supporting work from `codex`, then merge or cherry-pick back into `dev` and delete them promptly.
- Avoid accumulating `wip/...` branches and detached worktrees unless there is a specific reason to preserve unfinished state.

## Node Layout

### `wag-air` (Mac)

- orchestration, documentation, branch work
- parser and unit-test execution
- artifact review and promotion decisions

### `wag-x870e` (Ubuntu)

- historical data collection
- Python-side preprocessing
- research support and non-MT5 batch work

### `wag-dell` (Windows / MT5)

- MetaTrader 5 compile and tester execution
- full EA bundle deployment
- fresh tester logs and reports

This project does not assume research, implementation, and MT5 execution happen on one host.

## Local Preflight

Before changing EA logic or parser contracts:

```bash
git status --short
```

Parser regression check:

```bash
cd src/Scripts/tests
python -m unittest -v test_analyze_mt5_report.py
```

OpenCode workspace commands remain available when you need the upstream runtime:

```bash
bun install
bun run dev
```

## Working Loop

1. Read `EA_TRADING_PLAN.md` and confirm the active phase.
2. Check whether the task touches `RiskManagement`, parser/gates, or Sentinel boundaries.
3. Update only the files required for that phase.
4. Run local parser tests when changing gate or report logic.
5. Deploy the full EA bundle to `wag-dell` when MT5-side behavior changes.
6. Run compile, smoke, and parser gate checks.
7. Record pass, hold, or reject evidence under `backtest/results/`.

The project rule is still `Safety Gate first. Strategy second. ML last.` Live trading remains `NO-GO` until the critical gates in `EA_TRADING_PLAN.md` are complete.

## Full Bundle Deployment

Single-file MT5 sync is not allowed when dependent includes changed.

Deploy the full bundle:

```text
src/Expert_Main.mq5
src/Include/BrokerSymbolProfile.mqh
src/Include/TradeExecutor.mqh
src/Include/RiskManagement.mqh
src/Include/TradeLogic.mqh
src/Include/DataFeed.mqh
backtest/gate_config.json
backtest/tester/*.ini
```

Use [REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md](./REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md) for the exact remote compile and smoke sequence.

## Task Boundaries

- Agent roles, handoff rules, and hard-task review expectations are defined in [AGENTS.md](./AGENTS.md).
- Memory handoff architecture is documented in [MEMORY_HANDOFF_ARCHITECTURE.md](./MEMORY_HANDOFF_ARCHITECTURE.md).
- This document does not redefine agent permissions or coding policy; it points to the operational path for this checkout.

## Expected Artifacts

Keep evidence in repository paths that other phases already consume:

- `backtest/results/` for pass/fail JSON and captured gate output
- `backtest/tester/` for tester config inputs
- `src/Scripts/tests/` for parser regression tests

When a candidate is rejected, keep the rejection evidence and reason instead of silently replacing it.

## Common Entry Points

- Trading plan and gates: [EA_TRADING_PLAN.md](./EA_TRADING_PLAN.md)
- Sentinel design: [SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md](./SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md)
- Strict remediation constraints: [STRICT_REMEDIATION_PLAN.md](./STRICT_REMEDIATION_PLAN.md)
- Remote MT5 execution: [REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md](./REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md)
- Architecture overview: [ARCHITECTURE.md](./ARCHITECTURE.md)
