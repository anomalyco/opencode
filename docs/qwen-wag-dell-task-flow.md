# Qwen3.7-Plus 向け wag-dell Task A-D 実行順書

## 目的

`wag-dell` 復旧後の MT5 残作業を、`qwen3.7-plus` が 1 task ずつ安全に進められるように整理する。

この文書は以下を統合する。

- Task A-D の全体順序
- `docs/mt5-report-recovery-runbook.md` の差し込み位置
- baseline と Step2 operational stop で扱いが異なる点
- `pass / hold / reject` の使い分け

## 前提

- 1 回の依頼で 1 task だけ実行する
- compile 前に smoke に進まない
- stale log/report を使わない
- include 更新時は single-file sync しない
- parser 修正と MQL5 修正を同一 task に混ぜない

## Task A-D 全体像

### Task A

- full bundle 配備
- MetaEditor compile
- 完了条件: `0 errors, 0 warnings`

### Task B

- baseline smoke 実行
- fresh log/report 回収
- report が出ない場合は recovery runbook を差し込む

### Task C

- baseline parser 実行
- report metrics 必須

### Task D1

- Step2 global stop retest

### Task D2

- Step2 daily stop retest

### Task D3

- Step2 monthly stop retest

## report recovery runbook の差し込み位置

### 基本ルール

`docs/mt5-report-recovery-runbook.md` は **Task B と Task C の間** に入る。

ただし、Step2 operational stop 系では **Task D1-D3 の中でも再利用** する。

### 差し込み位置 1: baseline 系

順序は以下。

1. Task A
2. Task B baseline smoke
3. fresh report が取れた
4. Task C baseline parser

もし Task B で fresh report が取れなければ、以下へ分岐する。

1. Task B baseline smoke
2. report 未生成
3. `mt5-report-recovery-runbook` を実行
4. local ini + platform 相対 report path（`reports\step2_baseline.htm`）で baseline smoke を再実行
5. report が取れたら Task C へ進む
6. なお report が無ければ baseline は `hold`

### 差し込み位置 2: Step2 operational stop 系

順序は以下。

1. Task D1 / D2 / D3 を実行
2. report が取れれば通常どおり parser 実行
3. report が無ければ `mt5-report-recovery-runbook` を使って platform 相対 path で再実行
4. なお report が取れない場合でも、D1 / D2 / D3 の各 Step2 scenario では log-only fallback を許す

## 重要な違い

### baseline / sentinel 系

- `backtest/gate_config.json` の `default.require_report_metrics` は `true`
- HTML report が無ければ parser gate を完了扱いにしない
- report 未生成のまま次へ進めない

### Step2 operational stop 系

- `backtest/gate_config.json` の D1 / D2 / D3 用 scenario は `require_report_metrics: false`
- D1: `step2_operational_stop`
- D2: `step2_operational_stop_daily`
- D3: `step2_operational_stop_monthly`
- HTML report が取れなくても log-only parser が可能
- ただし fresh log は必須

## parser scenario 名の固定

`qwen3.7-plus` が迷いやすい点なので、ここを固定する。

### Task C baseline

- `--scenario step2_baseline_smoke`
- `gate_config.json` に専用 entry は無いが、default ルールで評価される

### Task D1 / D2 / D3

- parser の `--scenario` はケース別に固定する
- output JSON file 名はケース別に分けてよい

例:

- D1 output: `backtest/results/step2_global_stop_retest.json`
- D2 output: `backtest/results/step2_daily_stop_retest.json`
- D3 output: `backtest/results/step2_monthly_stop_retest.json`

- D1: `step2_operational_stop`
- D2: `step2_operational_stop_daily`
- D3: `step2_operational_stop_monthly`

## 実行順の詳細

### Task A

実行内容:

1. `wag-dell` 接続確認
2. AXIORY MT5 配備先確認
3. full bundle 配備
4. MetaEditor compile

完了条件:

- `0 errors, 0 warnings`

停止条件:

- compile error
- compile warning
- 配備先不明

### Task B

実行内容:

1. `step2_baseline.ini` で smoke
2. fresh log 確認
3. fresh report 確認

完了条件:

- smoke 完走
- fresh log 取得
- fresh report 取得

分岐:

- report が無い場合は `mt5-report-recovery-runbook` へ進む

### Task B-R: report recovery

実行内容:

1. tracked ini を `wag-dell` の `Downloads` にコピー
2. local ini を生成
3. `Report=` を platform 相対 `reports\...` に差し替え
4. 旧 report 削除
5. local ini で baseline smoke 再実行
6. report existence / size / mtime 確認

完了条件:

- `C:\Program Files\Axiory MetaTrader 5\reports\step2_baseline.htm` が fresh に生成される

失敗時:

- baseline は `hold`
- Task C に進まない

### Task C

実行内容:

1. baseline log/report を parser に渡す
2. `backtest/results/step2_baseline.json` を生成

実行例:

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --report "C:/Program Files/Axiory MetaTrader 5/reports/step2_baseline.htm" \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Terminal/ED051E4A9BEE8A33BDDD0F947358B2B2/Tester/logs/20260612.log" \
  --scenario step2_baseline_smoke \
  --config backtest/gate_config.json \
  --out backtest/results/step2_baseline.json
```

完了条件:

- parser 完走
- JSON 生成
- `passed` 判定取得

### Task D1 / D2 / D3

各 task で共通する流れ:

1. 対応 ini で smoke 実行
2. fresh log 回収
3. fresh report があれば通常 parser
4. report が無ければ report recovery
5. なお report が無くても fresh log があり、該当 parser が通るなら log-only fallback を許す

#### D1 対象

- `step2_global_stop.ini`
- output: `backtest/results/step2_global_stop_retest.json`

#### D2 対象

- `step2_daily_stop.ini`
- output: `backtest/results/step2_daily_stop_retest.json`

#### D3 対象

- `step2_monthly_stop.ini`
- output: `backtest/results/step2_monthly_stop_retest.json`

#### D系 parser 実行例

D1 parser あり（global-stop 型）:

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --report "C:/Program Files/Axiory MetaTrader 5/reports/step2_global_stop.htm" \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Terminal/ED051E4A9BEE8A33BDDD0F947358B2B2/Tester/logs/20260612.log" \
  --scenario step2_operational_stop \
  --config backtest/gate_config.json \
  --out backtest/results/step2_global_stop_retest.json
```

D1 report なしの log-only fallback:

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Terminal/ED051E4A9BEE8A33BDDD0F947358B2B2/Tester/logs/20260612.log" \
  --scenario step2_operational_stop \
  --config backtest/gate_config.json \
  --out backtest/results/step2_global_stop_retest.json
```

D2 parser あり（daily-stop 型）:

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --report "C:/Program Files/Axiory MetaTrader 5/reports/step2_daily_stop.htm" \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Terminal/ED051E4A9BEE8A33BDDD0F947358B2B2/Tester/logs/20260612.log" \
  --scenario step2_operational_stop_daily \
  --config backtest/gate_config.json \
  --out backtest/results/step2_daily_stop_retest.json
```

D2 report なしの log-only fallback:

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Terminal/ED051E4A9BEE8A33BDDD0F947358B2B2/Tester/logs/20260612.log" \
  --scenario step2_operational_stop_daily \
  --config backtest/gate_config.json \
  --out backtest/results/step2_daily_stop_retest.json
```

D3 parser あり（monthly-stop 型）:

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --report "C:/Program Files/Axiory MetaTrader 5/reports/step2_monthly_stop.htm" \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Terminal/ED051E4A9BEE8A33BDDD0F947358B2B2/Tester/logs/20260612.log" \
  --scenario step2_operational_stop_monthly \
  --config backtest/gate_config.json \
  --out backtest/results/step2_monthly_stop_retest.json
```

D3 report なしの log-only fallback:

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Terminal/ED051E4A9BEE8A33BDDD0F947358B2B2/Tester/logs/20260612.log" \
  --scenario step2_operational_stop_monthly \
  --config backtest/gate_config.json \
  --out backtest/results/step2_monthly_stop_retest.json
```

## qwen3.7-plus への依頼単位

`qwen3.7-plus` には 1 回で 1 task だけ渡す。

推奨順:

1. Task A
2. Task B
3. Task B-R
4. Task C
5. Task D1
6. Task D1-R
7. Task D2
8. Task D2-R
9. Task D3
10. Task D3-R

`-R` は report recovery が必要になった時だけ実行する補助 task とする。

## status の使い分け

### pass

- task 本来の完了条件を満たした

### hold

- 実行自体は進んだが、artifact 不足で次工程へ進めない
- 例: baseline smoke は通ったが fresh report が無い

### reject

- 実行失敗、gate failure、または想定外エラー

### D系の特例

- report 未生成でも log-only parser が通った場合、D系は evidence gathering を継続してよい
- ただし出力 status は `hold` とし、notes に `log-only fallback` を必ず書く
- その後 D2 / D3 へ進むことは許可する
- D3 の場合は report 未生成が継続しても、再実行ごとに `before/after` log メタ情報と recovery 回数を記録し、
  `log-only passed=true` を 2 回連続で受けた場合のみ次タスクへ進む。
- D3 で `log-only passed=false` が 2 回連続したら `Task D3` を即 `reject` とし、
  marker 要件見直し or parser 分岐の追加を blocker として引き継ぐ。

## 実行後に残す evidence

- compile summary
- tester log path
- report path
- parser output JSON path
- `SPRINT.md` または別 evidence note に残す要約

## 禁止事項

- tracked ini に absolute Windows path を commit しない
- baseline/sentinel で report 未生成のまま `pass` にしない
- D系 parser に `step2_global_stop_retest` などを scenario 名として渡さない
- stale report を使わない
- 1 回の依頼で複数 task をまとめて実行しない
