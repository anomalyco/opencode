# MT5 Report Recovery Runbook

## 目的

`wag-dell` 上で MT5 CLI 実行時に fresh HTML report が不安定に見つからない問題を、Windows ローカルの generated ini と platform directory 相対 `Report=` で回避する。

この手順の狙いは以下です。

- tracked の `backtest/tester/*.ini` を host 固有 path で汚さない
- `Report=` の出力先を deterministic に固定する
- stale report の誤読を防ぐ
- Task B / C の完了条件を機械的に確認できるようにする

補足: Step2 closure の本フェーズでは `run_d3_recovery.ps1` の再導入は行わず、当該 recovery 運用は別タスクで分離して扱う。

## 監査結果

blocking 問題はありません。採用してよい方針です。

ただし、以下を手順に必須条件として追加します。

1. `Report=` は `reports\...` のような platform 相対パスを使う
2. 拡張子は `.htm` を明示する
3. tracked ini は直接編集せず、`wag-dell` 上で local ini を生成する
4. 実行前に旧 report を削除し、実行後に存在と更新時刻を確認する

## 適用対象

- `step2_baseline`
- `step2_global_stop`
- `step2_daily_stop`
- `step2_monthly_stop`

## 使うパス

### repo 側入力

- `backtest/tester/step2_baseline.ini`
- `backtest/tester/step2_global_stop.ini`
- `backtest/tester/step2_daily_stop.ini`
- `backtest/tester/step2_monthly_stop.ini`

### wag-dell 側 canonical report path

- `reports\step2_baseline.htm`
- `reports\step2_global_stop.htm`
- `reports\step2_daily_stop.htm`
- `reports\step2_monthly_stop.htm`

### wag-dell 側 local ini 生成先

- `C:\Users\wag\Downloads\step2_baseline.local.ini`
- `C:\Users\wag\Downloads\step2_global_stop.local.ini`
- `C:\Users\wag\Downloads\step2_daily_stop.local.ini`
- `C:\Users\wag\Downloads\step2_monthly_stop.local.ini`

## 手順

### 1. base ini を wag-dell にコピーする

Mac 側から実行する。

```bash
scp backtest/tester/step2_baseline.ini wag-dell:C:/Users/wag/Downloads/
scp backtest/tester/step2_global_stop.ini wag-dell:C:/Users/wag/Downloads/
scp backtest/tester/step2_daily_stop.ini wag-dell:C:/Users/wag/Downloads/
scp backtest/tester/step2_monthly_stop.ini wag-dell:C:/Users/wag/Downloads/
```

### 2. wag-dell で local ini を生成する

PowerShell で以下を実行する。例は baseline。

```powershell
$src = 'C:\Users\wag\Downloads\step2_baseline.ini'
$dst = 'C:\Users\wag\Downloads\step2_baseline.local.ini'
$platformDir = 'C:\Program Files\Axiory MetaTrader 5'
$reportsDir = Join-Path $platformDir 'reports'
$report = 'reports\step2_baseline.htm'
$reportFullPath = Join-Path $platformDir $report

if (-not (Test-Path $reportsDir)) {
  New-Item -ItemType Directory -Path $reportsDir
}

$text = Get-Content -Path $src -Raw
$text = $text -replace 'Report=.*', "Report=$report"
Set-Content -Path $dst -Value $text -Encoding ASCII
```

他の scenario も同じ手順で `Report=` だけ差し替える。

### 3. 実行前に旧 report を削除する

fresh 判定のため、同名 report を削除する。

```powershell
Remove-Item 'C:\Program Files\Axiory MetaTrader 5\reports\step2_baseline.htm' -ErrorAction SilentlyContinue
```

必要なら旧 log の時刻も控える。

### 4. local ini で MT5 CLI を実行する

```powershell
Start-Process -FilePath 'C:\Program Files\Axiory MetaTrader 5\terminal64.exe' `
  -ArgumentList '/config:C:\Users\wag\Downloads\step2_baseline.local.ini' `
  -Wait
```

### 5. report の存在と更新時刻を確認する

```powershell
Get-Item 'C:\Program Files\Axiory MetaTrader 5\reports\step2_baseline.htm' | Select-Object FullName, Length, LastWriteTime
```

完了条件:

- file exists
- `LastWriteTime` が今回実行分
- size が 0 でない

### 6. tester log の fresh さも確認する

```powershell
Get-ChildItem 'C:\Users\wag\AppData\Roaming\MetaQuotes\Terminal\ED051E4A9BEE8A33BDDD0F947358B2B2\Tester\logs' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 FullName, Length, LastWriteTime
```

### 7. parser を実行する

baseline のように report metrics 必須の scenario は、必ず `--report` を付ける。

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --report "C:/Program Files/Axiory MetaTrader 5/reports/step2_baseline.htm" \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Terminal/ED051E4A9BEE8A33BDDD0F947358B2B2/Tester/logs/<TASK_LOG_PATH>" \
  --scenario default \
  --config backtest/gate_config.json \
  --out backtest/results/step2_baseline.json
```

### 8. Step2 系 parser 実行（D1/D2/D3）

Step2 の D1/D2/D3 は log-only fallback が許容されるため、`--report` は任意。
report が取得できなくても、`--log` のみで parser を実行し、`require_report_metrics=false` 条件で pass を受け入れる。

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Terminal/ED051E4A9BEE8A33BDDD0F947358B2B2/Tester/logs/<TASK_LOG_PATH>" \
  --scenario step2_operational_stop \
  --config backtest/gate_config.json \
  --out backtest/results/step2_global_stop_retest.json

python3 src/Scripts/analyze_mt5_report.py \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Terminal/ED051E4A9BEE8A33BDDD0F947358B2B2/Tester/logs/<TASK_LOG_PATH>" \
  --scenario step2_operational_stop_daily \
  --config backtest/gate_config.json \
  --out backtest/results/step2_daily_stop_retest.json

python3 src/Scripts/analyze_mt5_report.py \
  --log "C:/Users/wag/AppData/Roaming/MetaQuotes/Terminal/ED051E4A9BEE8A33BDDD0F947358B2B2/Tester/logs/<TASK_LOG_PATH>" \
  --scenario step2_operational_stop_monthly \
  --config backtest/gate_config.json \
  --out backtest/results/step2_monthly_stop_retest.json
```

## 判定

### pass

- smoke が完走する
- fresh log がある
- fresh HTML report が platform reports 配下で生成される
- parser が完走する

### hold

- smoke は通るが report が未生成
- parser 実行前提の artifact が不足
- output path だけ不明

### reject

- smoke 自体が失敗
- report path を相対指定（`Report=...`）に変えても未生成
- parser が gate failure を返す

## fallback ルール

### Step2 operational stop 系

`backtest/gate_config.json` の Step2 operational stop 系 scenario は `require_report_metrics: false` なので、report 未生成でも log-only で継続可能。

- D1 global stop: `step2_operational_stop`
- D2 daily stop: `step2_operational_stop_daily`
- D3 monthly stop: `step2_operational_stop_monthly`

log-only fallback でも、各 scenario 固有の forced input marker と stop marker は必須とする。例えば daily は `InpDailyDDLimit=-0.001` と `CAUTION: Daily Drawdown limit reached`、monthly は `InpMonthlyDDLimit=-0.001` と `WARNING: Monthly Drawdown limit reached` を見る。

### D3 recovery の追跡強化（monthly stop）

- `Task D3` で report が得られない場合でも、次の監査項目を必ず保存する。
  - 実行前後の `Tester\logs` 最新ファイルの `Name / Length / LastWriteTime`
  - report 存在確認（有無 / size / mtime）
  - parser 出力 JSON の `passed` / `failed_rules` / `metrics.log_window_selected`
- `step2_monthly_stop_retest` の再実行時刻と該当ログファイルの更新時刻を対応付け
- 月次タスクは `report=missing` が継続しても `passed=true` の log-only なら `hold` のまま記録し、
  `Notes` に「`log-only fallback`」と `report missing 回数`を明記する。
- `report=missing` で log-only が `passed=false` のまま再実行しても 2 回続いたら、D3 を `reject` 化し再実行条件を明記する。

### baseline / sentinel 系

`default.require_report_metrics` が `true` のため、report 未生成のまま pass 扱いにしてはいけない。`hold` として止める。

## 禁止事項

- tracked ini に Windows absolute path を直接 commit しない
- stale report を使わない
- relative `Report=reports\step2_baseline.htm` のまま stale 判定しない
- report 未生成なのに baseline を pass 扱いにしない

## 補足

既存の `C:\Program Files\Axiory MetaTrader 5\reports\step2_baseline.htm` は 2026-06-10 時点で存在しており、MT5 自体が report を出力できることは確認済みです。問題は report 能力の欠如ではなく、CLI 実行時の `Report=` 出力先が固定されていないことです。
