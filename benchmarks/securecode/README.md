# SecureCode 負荷試験

SecCodeBench の SecureCode prompt を使って、OpenAI 互換の SecureCode endpoint に対する同時実行ごとのレイテンシと throughput を計測するための資産をこのディレクトリに集約しています。

## ディレクトリ構成

- `scripts/`: 実行入口。capacity / session / live load / trial workspace を置く
- `runners/`: Python runner 本体と chart renderer
- `workload/`: SecureCode ケース定義
- `monitoring/`: リモート GPU / system 監視スクリプト
- `publish/`: 結果を Notion に流す補助スクリプト
- `REPORT_AUTHORING_TIPS.md`: agent が最終レポートを書くときの観点
- `.env.example`: 共通環境変数テンプレート

## 事前準備

```bash
cd /path/to/securecode
python3 -m venv .venv-bench
source .venv-bench/bin/activate
python3 -m pip install --upgrade pip matplotlib
cp benchmarks/securecode/.env.example benchmarks/securecode/.env
```

`benchmarks/securecode/.env` の最低限:

```bash
SECURECODE_BASE_URL=http://localhost:8080/v1
SECURECODE_MODEL=model-under-test
SECURECODE_API_KEY=
```

## 入口コマンド

- request 単位の capacity test: `./benchmarks/securecode/scripts/run_securecode_capacity.sh`
- session 型 capacity test: `./benchmarks/securecode/scripts/run_securecode_session_capacity.sh`
- 背景 live load 開始/停止: `./benchmarks/securecode/scripts/securecode_session_loadctl.sh start|stop`
- 単体 trial workspace 作成: `./benchmarks/securecode/scripts/prepare_securecode_trial_workspace.sh`
- 単体 prompt を確認: `./benchmarks/securecode/scripts/securecode_trial.sh`
- Notion 公開補助: `python3 benchmarks/securecode/publish/publish_securecode_results_to_notion.py ...`

## Agent 向け導線

- Codex / OpenCode skill:
  - `.opencode/skills/securecode-benchmark/SKILL.md`
  - `.opencode/skills/securecode-report/SKILL.md`
- Claude Code skill:
  - `.claude/skills/securecode-benchmark.md`
  - `.claude/skills/securecode-report.md`

## request 単位の最短実行

1. benchmark 用の `.env` を設定する

```bash
cp benchmarks/securecode/.env.example benchmarks/securecode/.env
$EDITOR benchmarks/securecode/.env
```

2. benchmark 対象の OpenAI 互換 endpoint を起動する

例:

```bash
# SecureCode gateway / proxy / vLLM など
# SECURECODE_BASE_URL で指定した endpoint が /v1/chat/completions を受けられる状態にする
```

3. ベンチを流す

```bash
./benchmarks/securecode/scripts/run_securecode_capacity.sh
```

既定では `results/securecode-capacity-<UTC timestamp>/` に以下を出力します。

- `summary.json`
- `phase_metrics.csv`
- `phase_buckets.csv`
- `phase_analysis.json`
- `raw_results.jsonl`
- `charts/*.png`

## よく使う例

並列レンジを増やす:

```bash
./benchmarks/securecode/scripts/run_securecode_capacity.sh securecode-capacity-local \
  --concurrency 16,32,64,96,128,160 \
  --cycles 16 \
  --max-tokens 384
```

upstream の vLLM を直接叩く:

```bash
SECURECODE_BASE_URL=http://localhost:18000/v1 \
SECURECODE_API_KEY='' \
./benchmarks/securecode/scripts/run_securecode_capacity.sh
```

重めの応答条件で飽和点を探りやすくする:

```bash
SECURECODE_BASE_URL=https://your-securecode-endpoint.example.com/v1 \
SECURECODE_MODEL=your-model-alias \
SECURECODE_API_KEY=... \
SECURECODE_REMOTE_HOST=... \
SECURECODE_REMOTE_MONITOR_DIR=/absolute/path/to/benchmarks/securecode/monitoring \
./benchmarks/securecode/scripts/run_securecode_capacity_heavy_profile.sh
```

この heavy profile は次を固定します。

- `--concurrency 64,96,128,160,192,256,320,384`
- `--cycles 96` (`request_count=576`)
- `--max-tokens 384`

応答が軽すぎて ceiling が見えにくいときは、まず実行結果の `phase_metrics.csv` を見て、少なくとも以下が揃っているかを確認してください。

- `avg_completion_tokens` が `~359` 前後
- `request_count` が `576`
- 並列 sweep が `64..384`
- 監視あり run なら GPU / power / temp 列が埋まっている

`--max-tokens 128` のような軽い条件で流すと、throughput が大きく跳ね上がって heavy profile とは別ベンチになります。

## session 型の最短実行

```bash
./benchmarks/securecode/scripts/run_securecode_session_capacity.sh securecode-session-local \
  --concurrency 8,16,32,64 \
  --timeout-s 900
```

## リモート GPU 監視

ベンチ対象 endpoint はそのまま、GPU 使用率や電力を別ホストから回収したい場合は、リモート側にもこの `benchmarks/securecode` ディレクトリを置いてください。

`.env` 例:

```bash
SECURECODE_REMOTE_HOST=bench@example-host
SECURECODE_REMOTE_MONITOR_DIR=/absolute/path/to/benchmarks/securecode/monitoring
SECURECODE_REMOTE_RUN_ROOT=~/.cache/securecode/securecode-monitor/runs
```

この設定があると、実行時にリモートで `monitoring/securecode_monitor_remote.sh start/stop` を呼び、各 run の `monitoring/` 配下へ以下を保存します。

- `gpu_stats.csv`
- `gpu_pmon.log`
- `system_stats.csv`
- `process_snapshot.txt`
- `nvidia_smi_snapshot.txt`

## 補足

- SecCodeBench 本体は初回実行時に `~/.cache/securecode/sec-code-bench` へ clone されます。
- グラフ生成には `matplotlib` が必要です。未導入でもベンチ本体は動きますが、PNG はスキップされます。
- 監視なしでも `summary.json` / CSV は生成されます。
- `scripts/` 配下の shell は `benchmarks/securecode/.env` を共通で読みます。
- モデル名、backing model、価格情報、リモート監視ディレクトリはデプロイ先ごとに設定してください。repo の既定値は説明用の placeholder です。
- 最終的な日本語レポートは agent が `summary.json` / CSV / PNG を読みながら作る前提です。観点は [REPORT_AUTHORING_TIPS.md](./REPORT_AUTHORING_TIPS.md) にまとめています。
- 期待品質は、読みやすい日本語、4 種類のグラフ、画像の埋め込み表示、表直後の短い解釈まで含めて、高品質な benchmark メモとしてそのまま共有できる水準を目標にします。
- 負荷試験の既定目的は性能上限の把握です。最初の sweep で ceiling 未到達なら、skill は並列条件を自動で増やして限界が見えるまで続けます。
