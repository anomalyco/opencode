# Step2 Gate Re-Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-evaluate Step2 operational stop evidence against the current D1/D2/D3 gate definitions before Sentinel implementation proceeds.

**Architecture:** Treat `backtest/gate_config.json` as the gate contract, `src/Scripts/analyze_mt5_report.py` as the only parser authority, and `backtest/results/` plus `SPRINT.md` as the evidence ledger. D1/D2/D3 must be evaluated from scenario-specific fresh logs, not by replaying the same aggregate tester log three times.

**Tech Stack:** MQL5 tester artifacts, PowerShell runner scripts on `wag-dell`, Python `unittest`, `src/Scripts/analyze_mt5_report.py`, JSON evidence under `backtest/results/`.

---

## Scope

This plan does not implement Sentinel. It only decides whether Step2 operational stop evidence is current, sufficient, and safe enough to unblock Sentinel parser and signal work.

The in-scope scenarios are:

- D1 global stop: `step2_operational_stop`
- D2 daily stop: `step2_operational_stop_daily`
- D3 monthly stop: `step2_operational_stop_monthly`

The current blocker is recorded in `SPRINT.md`: existing D2/D3 evidence was produced around older gate assumptions and must be rechecked against the current per-scenario markers.

## Files

- Read: `AGENTS.md`
- Read: `DEVELOPMENT.md`
- Read: `EA_TRADING_PLAN.md`
- Read: `STRICT_REMEDIATION_PLAN.md`
- Read: `docs/mt5-report-recovery-runbook.md`
- Modify: `backtest/gate_config.json`
- Read: `backtest/tester/run_mt5_step2.ps1`
- Read: `backtest/tester/step2_global_stop.recovery.ini`
- Read: `backtest/tester/step2_daily_stop.recovery.ini`
- Read: `backtest/tester/step2_monthly_stop.recovery.ini`
- Read: `backtest/tester/step2_monthly_stop.local.ini`
- Read: `src/Scripts/analyze_mt5_report.py`
- Modify: `src/Scripts/tests/test_analyze_mt5_report.py`
- Create: `src/Scripts/validate_step2_reevaluation.py`
- Create: `src/Scripts/tests/test_validate_step2_reevaluation.py`
- Modify: `backtest/results/task-d1r-20260613.log`
- Modify: `backtest/results/task-d2r-20260613.log`
- Modify: `backtest/results/task-d3r-20260613.log`
- Modify: `backtest/results/step2_global_stop_retest.json`
- Modify: `backtest/results/step2_daily_stop_retest.json`
- Modify: `backtest/results/step2_monthly_stop_retest.json`
- Modify: `backtest/results/step2_operational_stop_reevaluation_summary.json`
- Modify: `SPRINT.md`
- Modify: `docs/superpowers/plans/2026-06-13-step2-gate-reevaluation.md`
- Modify: `backtest/tester/run_mt5_step2.ps1`
- Modify: `backtest/tester/step2_global_stop.recovery.ini`
- Modify: `backtest/tester/step2_daily_stop.recovery.ini`
- Modify: `backtest/tester/step2_monthly_stop.recovery.ini`
- Modify: `backtest/tester/step2_monthly_stop.local.ini`

## Non-Negotiable Rules

- Do not parse D1, D2, and D3 from the same aggregate tester log as the final evidence.
- Do not set `sentinel_unblocked: true` unless the final decision is `pass`.
- Do not treat `hold` as sufficient to start Sentinel implementation.
- Do not accept a summary JSON containing template values such as `pass|hold|reject` or an empty `reason`.
- Treat `src/Scripts/validate_step2_reevaluation.py` as the Sentinel-unblock validator: exit `0` means `decision: "pass"` with fresh D1/D2/D3 evidence; `hold` and `reject` are valid ledger outcomes but must not pass this validator.
- Do not stage unrelated `context-mode` files with the Step2 re-evaluation commit.

## Gate Contract

D1 must pass with all of these:

- `RISK_V3_ORDER_CALC_PROFIT`
- `InpGlobalDDLimit=-0.0005`
- `CRITICAL: Global Drawdown limit reached`
- `GLOBAL STOP: closed position`
- `Test passed`
- `orders_after_global_stop_count == 0`
- no `No money`
- no margin-related errors
- no warnings in final parser JSON

D2 must pass with all of these:

- `RISK_V3_ORDER_CALC_PROFIT`
- `InpDailyDDLimit=-0.001`
- `CAUTION: Daily Drawdown limit reached`
- `Test passed`
- no `CRITICAL: Global Drawdown limit reached`
- no `GLOBAL STOP:`
- no `No money`
- no margin-related errors
- no warnings in final parser JSON

D3 must pass with all of these:

- `RISK_V3_ORDER_CALC_PROFIT`
- `InpMonthlyDDLimit=-0.001`
- `WARNING: Monthly Drawdown limit reached`
- `Test passed`
- no `CRITICAL: Global Drawdown limit reached`
- no `GLOBAL STOP:`
- no `No money`
- no margin-related errors
- no warnings in final parser JSON

`require_report_metrics` is `false` for all Step2 operational stop scenarios, so missing HTML reports can be recorded as `hold` only when log-only parser output passes. Parser failure is always `reject`.

## Fresh Evidence Definition

A scenario has fresh evidence only when all of these are true:

- the scenario has its own log file under `backtest/results/task-d*r-20260613.log`;
- runner evidence records before/after tester log `Name`, `Length`, and `LastWriteTime`;
- the copied log includes the forced input marker and a fresh run window;
- parser JSON `created_at` is later than the fresh run log mtime;
- parser JSON `metrics.log_window_selected` is `true`;
- parser JSON `failed_rules` is empty;
- parser JSON `warnings` is empty.

If any item is missing, the scenario status is `hold` or `reject`, not `pass`.

## Task 1: Freeze Current Workspace State

**Files:**

- Read: `git status --short --branch`
- Read: `SPRINT.md`
- Read: `backtest/results/*.json`

- [ ] **Step 1: Capture current branch and dirty state**

Run:

```bash
git status --short --branch
```

Expected:

- Current branch is known.
- Existing untracked `context-mode` and backtest artifacts are not mixed into Step2 re-evaluation by accident.

- [ ] **Step 2: Record exact evidence files currently present**

Run:

```bash
rg --files backtest/results | sort
```

Expected:

- Existing Step2 JSON and task logs are visible before rerun.
- Any stale or duplicate `task-d*r-*` files are identified.

- [ ] **Step 3: Inspect current Step2 result status**

Run:

```bash
python3 - <<'PY'
from pathlib import Path

for name in [
    'step2_global_stop_retest.json',
    'step2_daily_stop_retest.json',
    'step2_monthly_stop_retest.json',
]:
    p = Path('backtest/results') / name
    print(f'=== {p}')
    print(p.read_text(encoding='utf-8')[:1200])
PY
```

Expected:

- Each JSON shows `scenario`, `passed`, `failed_rules`, `warnings`, and `metrics.log_window_selected`.
- These old JSON files are reference material only until fresh scenario-specific logs are produced.

## Task 1.5: Sync Runner Assets to Windows Execution Directory

**Files:**

- `backtest/tester/run_mt5_step2.ps1`
- `backtest/tester/step2_global_stop.recovery.ini`
- `backtest/tester/step2_daily_stop.recovery.ini`
- `backtest/tester/step2_monthly_stop.recovery.ini`

- [ ] **Step 1: Copy step2 runner and recovery ini files to `wag-dell`**

On `wag-dell`, run:

```powershell
Copy-Item .\backtest\tester\run_mt5_step2.ps1 C:\Users\wag\Downloads\run_mt5_step2.ps1 -Force
Copy-Item .\backtest\tester\step2_global_stop.recovery.ini C:\Users\wag\Downloads\step2_global_stop.recovery.ini -Force
Copy-Item .\backtest\tester\step2_daily_stop.recovery.ini C:\Users\wag\Downloads\step2_daily_stop.recovery.ini -Force
Copy-Item .\backtest\tester\step2_monthly_stop.recovery.ini C:\Users\wag\Downloads\step2_monthly_stop.recovery.ini -Force
```

Expected:

- Copied files match repo versions (especially `InpGlobalDDLimit` and `InpRequireExpectedAccountCurrency=false`).
- `run_mt5_step2.ps1` supports `-Scenario global|daily|monthly`.
- Missing config output uses `config=missing|...`, missing log root output uses `log_root=missing|...`, and `logWindowUpdated` considers tester log name, size, and mtime.

## Task 2: Verify Parser Contract Locally

**Files:**

- Read: `backtest/gate_config.json`
- Read: `src/Scripts/analyze_mt5_report.py`
- Test: `src/Scripts/tests/test_analyze_mt5_report.py`

- [ ] **Step 1: Run parser unit tests from the correct directory**

Run:

```bash
cd src/Scripts/tests
python -m unittest -v test_analyze_mt5_report.py
```

Expected:

- PASS.
- Tests covering `step2_operational_stop`, `step2_operational_stop_daily`, and `step2_operational_stop_monthly` pass.

- [ ] **Step 2: Stop if parser tests fail**

Expected action:

- Do not reclassify D1/D2/D3 evidence.
- Report the failing test name and failure message.
- Fix parser tests or gate config in a separate parser task before continuing.

## Task 3: Produce Fresh D1 Evidence

**Files:**

- Use on Windows: `backtest/tester/run_mt5_step2.ps1`
- Modify: `backtest/results/task-d1r-20260613.log`
- Modify: `backtest/results/step2_global_stop_retest.json`

- [ ] **Step 1: Run D1 global stop on `wag-dell`**

Run the D1/global-stop tester configuration with forced input:

```text
InpGlobalDDLimit=-0.0005
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\wag\Downloads\run_mt5_step2.ps1' -Scenario global
```

Expected:

- Tester log mtime changes after the run starts.
- Runner evidence records before/after tester log `Name`, `Length`, and `LastWriteTime`.
- Report existence is checked and recorded even if report is missing.

- [ ] **Step 2: Copy D1 fresh log into repo evidence**

Create:

```text
backtest/results/task-d1r-20260613.log
```

Expected:

- File contains only or clearly includes the fresh D1 run window.
- File contains `InpGlobalDDLimit=-0.0005`.

- [ ] **Step 3: Parse D1 fresh log**

Run:

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --log backtest/results/task-d1r-20260613.log \
  --scenario step2_operational_stop \
  --config backtest/gate_config.json \
  --out backtest/results/step2_global_stop_retest.json
```

Expected:

- Exit code `0`.
- `passed` is `true`.
- `failed_rules` is empty.
- `warnings` is empty.
- `metrics.log_window_selected` is `true`.
- `metrics.global_stop_count >= 1`.
- `metrics.global_close_count >= 1`.
- `metrics.orders_after_global_stop_count == 0`.

## Task 4: Produce Fresh D2 Evidence

**Files:**

- Use on Windows: `backtest/tester/run_mt5_step2.ps1`
- Modify: `backtest/results/task-d2r-20260613.log`
- Modify: `backtest/results/step2_daily_stop_retest.json`

- [ ] **Step 1: Run D2 daily stop on `wag-dell`**

Run the D2/daily-stop tester configuration with forced input:

```text
InpDailyDDLimit=-0.001
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\wag\Downloads\run_mt5_step2.ps1' -Scenario daily
```

Expected:

- Tester log mtime changes after the run starts.
- Runner evidence records before/after tester log `Name`, `Length`, and `LastWriteTime`.
- Report existence is checked and recorded even if report is missing.

- [ ] **Step 2: Copy D2 fresh log into repo evidence**

Create:

```text
backtest/results/task-d2r-20260613.log
```

Expected:

- File contains only or clearly includes the fresh D2 run window.
- File contains `InpDailyDDLimit=-0.001`.

- [ ] **Step 3: Parse D2 fresh log**

Run:

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --log backtest/results/task-d2r-20260613.log \
  --scenario step2_operational_stop_daily \
  --config backtest/gate_config.json \
  --out backtest/results/step2_daily_stop_retest.json
```

Expected:

- Exit code `0`.
- `passed` is `true`.
- `failed_rules` is empty.
- `warnings` is empty.
- `metrics.log_window_selected` is `true`.
- `metrics.global_stop_count == 0`.
- `metrics.global_close_count == 0`.
- `metrics.no_money_count == 0`.
- `metrics.margin_error_count == 0`.

## Task 5: Produce Fresh D3 Evidence

**Files:**

- Use on Windows: `backtest/tester/run_mt5_step2.ps1`
- Modify: `backtest/results/task-d3r-20260613.log`
- Modify: `backtest/results/step2_monthly_stop_retest.json`

- [ ] **Step 1: Run D3 monthly stop recovery on `wag-dell`**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\wag\Downloads\run_mt5_step2.ps1' -Scenario monthly
```

Expected:

- Tester log mtime changes after the run starts.
- Runner evidence records before/after tester log `Name`, `Length`, and `LastWriteTime`.
- Report existence check records path, exists flag, size, and mtime.
- If report is missing, report missing count is recorded in notes.

- [ ] **Step 2: Copy D3 fresh log into repo evidence**

Create:

```text
backtest/results/task-d3r-20260613.log
```

Expected:

- File contains only or clearly includes the fresh D3 run window.
- File contains `InpMonthlyDDLimit=-0.001`.

- [ ] **Step 3: Parse D3 fresh log**

Run:

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --log backtest/results/task-d3r-20260613.log \
  --scenario step2_operational_stop_monthly \
  --config backtest/gate_config.json \
  --out backtest/results/step2_monthly_stop_retest.json
```

Expected:

- Exit code `0`.
- `passed` is `true`.
- `failed_rules` is empty.
- `warnings` is empty.
- `metrics.log_window_selected` is `true`.
- `metrics.global_stop_count == 0`.
- `metrics.global_close_count == 0`.
- `metrics.no_money_count == 0`.
- `metrics.margin_error_count == 0`.

## Task 6: Audit JSON Outputs

**Files:**

- Read: `backtest/results/step2_global_stop_retest.json`
- Read: `backtest/results/step2_daily_stop_retest.json`
- Read: `backtest/results/step2_monthly_stop_retest.json`

- [ ] **Step 1: Audit D1 JSON**

Run:

```bash
grep -n '"scenario"\|"passed"\|"failed_rules"\|"warnings"\|"log_window_selected"\|"global_stop_count"\|"global_close_count"\|"orders_after_global_stop_count"' backtest/results/step2_global_stop_retest.json
```

Expected:

- `scenario` is `step2_operational_stop`.
- `passed` is `true`.
- `failed_rules` is empty.
- `warnings` is empty.
- `log_window_selected` is `true`.
- `global_stop_count >= 1`.
- `global_close_count >= 1`.
- `orders_after_global_stop_count == 0`.

- [ ] **Step 2: Audit D2 JSON**

Run:

```bash
grep -n '"scenario"\|"passed"\|"failed_rules"\|"warnings"\|"log_window_selected"\|"global_stop_count"\|"global_close_count"\|"no_money_count"\|"margin_error_count"' backtest/results/step2_daily_stop_retest.json
```

Expected:

- `scenario` is `step2_operational_stop_daily`.
- `passed` is `true`.
- `failed_rules` is empty.
- `warnings` is empty.
- `log_window_selected` is `true`.
- `global_stop_count == 0`.
- `global_close_count == 0`.
- `no_money_count == 0`.
- `margin_error_count == 0`.

- [ ] **Step 3: Audit D3 JSON**

Run:

```bash
grep -n '"scenario"\|"passed"\|"failed_rules"\|"warnings"\|"log_window_selected"\|"global_stop_count"\|"global_close_count"\|"no_money_count"\|"margin_error_count"' backtest/results/step2_monthly_stop_retest.json
```

Expected:

- `scenario` is `step2_operational_stop_monthly`.
- `passed` is `true`.
- `failed_rules` is empty.
- `warnings` is empty.
- `log_window_selected` is `true`.
- `global_stop_count == 0`.
- `global_close_count == 0`.
- `no_money_count == 0`.
- `margin_error_count == 0`.

## Task 7: Add Machine Validation for the Re-Evaluation Summary

**Files:**

- Test: `src/Scripts/tests/test_validate_step2_reevaluation.py`
- Test: `src/Scripts/validate_step2_reevaluation.py`

- [ ] **Step 1: Create validator tests first**

Run:

```bash
cd src/Scripts/tests
python -m unittest -v test_validate_step2_reevaluation.py
```

Expected:

- FAIL while validator is missing.

- [ ] **Step 2: Implement validator and rerun tests**

Run:

```bash
cd src/Scripts/tests
python -m unittest -v test_validate_step2_reevaluation.py
```

Expected:

- PASS.

## Task 8: Produce Re-Evaluation Summary

**Files:**

- Modify: `backtest/results/step2_operational_stop_reevaluation_summary.json`

- [ ] **Step 1: Write final summary JSON with concrete values**

Create `backtest/results/step2_operational_stop_reevaluation_summary.json` with this shape:

```json
{
  "date": "2026-06-13",
  "decision": "pass",
  "scenarios": {
    "D1": {
      "scenario": "step2_operational_stop",
      "result_path": "backtest/results/step2_global_stop_retest.json",
      "log_path": "backtest/results/task-d1r-20260613.log",
      "status": "pass",
      "reason": "fresh global-stop log passed current parser gate with no failed rules or warnings"
    },
    "D2": {
      "scenario": "step2_operational_stop_daily",
      "result_path": "backtest/results/step2_daily_stop_retest.json",
      "log_path": "backtest/results/task-d2r-20260613.log",
      "status": "pass",
      "reason": "fresh daily-stop log passed current parser gate with no failed rules or warnings"
    },
    "D3": {
      "scenario": "step2_operational_stop_monthly",
      "result_path": "backtest/results/step2_monthly_stop_retest.json",
      "log_path": "backtest/results/task-d3r-20260613.log",
      "status": "pass",
      "reason": "fresh monthly-stop log passed current parser gate with no failed rules or warnings"
    }
  },
  "sentinel_unblocked": true,
  "notes": []
}
```

If any scenario is not a clean parser pass, change the concrete `decision`, per-scenario `status`, `reason`, `sentinel_unblocked`, and `notes`. Do not leave template alternatives or empty reasons.

Decision rules:

- `decision: "pass"` only if D1/D2/D3 all satisfy the Fresh Evidence Definition.
- `decision: "hold"` if parser gates pass but freshness, report tracking, or warning review is incomplete.
- `decision: "reject"` if any parser gate fails.
- `sentinel_unblocked: true` only when `decision` is exactly `"pass"`.
- The validator below is intentionally stricter than the ledger: it exits `0` only for `decision: "pass"`; `hold` or `reject` must remain visible as blocked states.

- [ ] **Step 2: Validate summary JSON**

Run:

```bash
python3 -m json.tool backtest/results/step2_operational_stop_reevaluation_summary.json >/dev/null
python3 src/Scripts/validate_step2_reevaluation.py \
  --summary backtest/results/step2_operational_stop_reevaluation_summary.json
```

Expected:

- `json.tool` exits `0`.
- Validator exits `0` only when the summary is a final `pass` with fresh D1/D2/D3 evidence.

## Task 9: Update Sprint Ledger

**Files:**

- Modify: `SPRINT.md`

- [ ] **Step 1: Add a superseding sprint row**

Add one row under `Current Sprint` with:

- Date: `2026-06-13`
- Owner: actual runner, for example `codex` or `qwen3.7-plus`
- Scope: `Step2 gate re-evaluation`
- Evidence: the three Step2 JSON paths, three fresh log paths, and summary JSON
- Status: `pass`, `hold`, or `reject`
- Notes: mention current gate names, log-only fallback status, report missing status, and whether Sentinel remains blocked

- [ ] **Step 2: Preserve old rows**

Expected:

- Old rows remain unchanged.
- The new row clearly supersedes the old gate-assumption hold row.

## Task 10: Final Verification Before Sentinel Work

**Files:**

- Test: `src/Scripts/tests/test_analyze_mt5_report.py`
- Read: `SPRINT.md`
- Read: `backtest/results/step2_*_retest.json`
- Read: `backtest/results/step2_operational_stop_reevaluation_summary.json`

- [ ] **Step 1: Re-run parser tests**

Run:

```bash
cd src/Scripts/tests
python -m unittest -v test_analyze_mt5_report.py
```

Expected:

- PASS.

- [ ] **Step 2: Check unstaged and staged file sets**

Run:

```bash
git diff --name-only
git diff --name-only --cached
git status --short
```

Expected:

- Step2 re-evaluation files are visible.
- Unrelated `context-mode` PoC files are not staged with Step2.
- Generated `__pycache__` files are not staged.

- [ ] **Step 3: Commit the plan and re-evaluation**

Use this only after reviewing generated JSON paths:

```bash
git add docs/superpowers/plans/2026-06-13-step2-gate-reevaluation.md \
  SPRINT.md \
  backtest/tester/run_mt5_step2.ps1 \
  backtest/tester/step2_global_stop.recovery.ini \
  backtest/tester/step2_daily_stop.recovery.ini \
  backtest/tester/step2_monthly_stop.recovery.ini \
  backtest/tester/step2_monthly_stop.local.ini \
  backtest/gate_config.json \
  backtest/results/task-d1r-20260613.log \
  backtest/results/task-d2r-20260613.log \
  backtest/results/task-d3r-20260613.log \
  backtest/results/step2_global_stop_retest.json \
  backtest/results/step2_daily_stop_retest.json \
  backtest/results/step2_monthly_stop_retest.json \
  backtest/results/step2_operational_stop_reevaluation_summary.json \
  src/Scripts/validate_step2_reevaluation.py \
  src/Scripts/tests/test_analyze_mt5_report.py \
  src/Scripts/tests/test_validate_step2_reevaluation.py
git commit -m "test(mt5): re-evaluate step2 operational stop gates"
```

Expected:

- Commit contains no unrelated `context-mode` files.
- Commit excludes `__pycache__`, old `20260612` reference logs, and obsolete one-off recovery runners unless intentionally reviewed.
- Commit message follows `type(scope): summary`.

## Stop Conditions

Stop and report instead of continuing if:

- parser unit tests fail;
- any Step2 parser run returns non-zero;
- D2 or D3 include global stop markers;
- D1 has orders after global stop;
- log window selection fails;
- scenario-specific fresh log cannot be produced;
- fresh log mtime, size, and parser `created_at` cannot be tied together;
- summary JSON contains `pass|hold|reject` template text or empty `reason`;
- summary decision is `hold` or `reject` and any step tries to unblock Sentinel;
- unrelated dirty files would be mixed into the Step2 commit.

## Sentinel Unblock Criteria

Sentinel parser or signal implementation may proceed only after:

- D1, D2, and D3 are all re-evaluated under current `backtest/gate_config.json`;
- each scenario has its own fresh log evidence;
- all three parser JSON files have `passed: true`, empty `failed_rules`, empty `warnings`, and `metrics.log_window_selected: true`;
- `backtest/results/step2_operational_stop_reevaluation_summary.json` has `decision: "pass"` and `sentinel_unblocked: true`;
- `SPRINT.md` has a superseding row for the re-evaluation;
- parser tests pass after evidence update;
- no Step2 `hold` or `reject` remains open.
