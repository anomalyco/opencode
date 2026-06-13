# Sprint Record

このファイルは `AGENTS.md` の `SPRINT.md` 参照に対応する運用ログです。
長期計画の詳細は `ROADMAP.md` を参照し、短期の実施結果はここに追記します。

## Current Sprint

| Date | Owner | Scope | Evidence | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-06-13 | opencode | Step2 gate re-evaluation | `backtest/results/step2_global_stop_retest.json`, `backtest/results/step2_daily_stop_retest.json`, `backtest/results/step2_monthly_stop_retest.json`, `backtest/results/task-d1r-20260613.log`, `backtest/results/task-d2r-20260613.log`, `backtest/results/task-d3r-20260613.log`, `backtest/results/step2_operational_stop_reevaluation_summary.json` | pass | Supersedes 2026-06-12 gate-assumption hold rows. D1=`step2_operational_stop`, D2=`step2_operational_stop_daily`, D3=`step2_operational_stop_monthly` all passed current log-only parser gates with `failed_rules=[]`, `warnings=[]`, and `log_window_selected=true`; reports remained missing but `require_report_metrics=false`; Sentinel unblocked by summary validator. |
| 2026-06-13 | codex | Step2 gate audit follow-up closure | `backtest/results/step2_operational_stop_reevaluation_summary.json`, `backtest/results/step2_*_retest.json` | pass | 2026-06-12 の hold 状態を再評価で再収束。Task D2/D3 の履歴は保持しつつ、現行運用は再評価 pass をもって close とする。 |
| 2026-06-12 | qwen3.7-plus | D3-R hold (log-only fallback) | `backtest/results/step2_monthly_stop_retest.json`, `backtest/results/task-d3r-20260612.log` | hold | `step2_operational_stop` parser passed (`InpGlobalDDLimit=-0.0005`, `InpRequireExpectedAccountCurrency=false`), report 未生成のため hold |
| 2026-06-12 | qwen3.7-plus | D1-R hold (log-only fallback) | `backtest/results/step2_global_stop_retest.json`, `backtest/results/20260612.log` | hold | `step2_operational_stop` parser は pass、`report` は未生成。`step2_global_stop` 実行ログは最新更新 |
| 2026-06-12 | qwen3.7-plus | D2 | `backtest/results/step2_daily_stop_retest.json`, `backtest/results/20260612.log` | hold | `step2_operational_stop_daily` parser へ分岐し、`InpDailyDDLimit` + `Test passed` で log-only `passed=true`。report 未生成のため hold |
| 2026-06-12 | qwen3.7-plus | D2-R | `backtest/results/step2_daily_stop_retest.json`, `backtest/results/20260612.log`, `C:\Users\wag\Downloads\step2_daily_stop.local.ini` | hold | D2-R 再実行で `step2_operational_stop_daily` を採用し log-only `passed=true`。`daily` 系 marker が一致。report recovery は継続失敗 |
| 2026-06-12 | qwen3.7-plus | D3 | `backtest/results/step2_monthly_stop_retest.json`, `backtest/results/20260612.log`, `C:\Users\wag\Downloads\step2_monthly_stop.local.ini` | hold | D3 の再実行でも report 未生成。`step2_operational_stop` parser は再生成 log-only で `passed=true`（`global stop` marker 到達）ため hold、notes に `log-only fallback` |
| 2026-06-12 | qwen3.7-plus | D3-R | `backtest/results/task-d3r-20260612-recovery.log`, `backtest/results/step2_monthly_stop_retest.json`, `backtest/results/20260612.log` | hold | D3-R 再実行。`before=20260612.log|2464710|14:06:25`, `after=20260612.log|2477438|14:18:08`, `report=missing`, `logWindowUpdated=updated`、`parser passed=true`、`failed_rules=[]` |
| 2026-06-12 | qwen3.7-plus | E | `backtest/results/step2_global_stop_retest.json`, `backtest/results/step2_daily_stop_retest.json`, `backtest/results/step2_monthly_stop_retest.json`, `SPRINT.md` | pass | D1/D2/D3 の result/ログ証跡を整理。Task E 実施完了。 |
| 2026-06-12 | codex | Step2 gate audit follow-up | `backtest/gate_config.json`, `src/Scripts/tests/test_analyze_mt5_report.py` | hold | 上記 D2/D3 系 evidence は旧 gate に基づく記録。現行 gate は D1=`step2_operational_stop`、D2=`step2_operational_stop_daily`、D3=`step2_operational_stop_monthly` の固有 marker を要求するため再評価が必要 |

## Review

- **Sprint close condition**: 主要計画が更新され、監査で指摘された破綻リンクが解消されていること
- **Evidence policy**: 実施時の成果・判断は本表に要約記録し、詳細は対象PR / コミットへ遡れるよう保持する
