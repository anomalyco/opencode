---
name: securecode-benchmark
description: Run a SecureCode benchmark and verify the generated artifacts
---

`benchmarks/securecode/README.md` を最初に読んでから進めること。

ユーザーの要求と `$ARGUMENTS` を見て、`request capacity` か `session capacity` かを判定する。指定が曖昧なら `request capacity` を既定にする。

やること:

1. まず通常 run か再現 run かを決める
   - 飽和点を見えやすくするために重い応答条件が必要なら `benchmarks/securecode/scripts/run_securecode_capacity_heavy_profile.sh` を優先する
   - それ以外は通常の request/session script を使う
2. repository root から benchmark を実行する
   - `SECURECODE_OUTPUT_ROOT` は既定で project 内の `results/` に置く
   - ユーザーが明示しない限り `/tmp` へは出さない
3. 必要なら小さい smoke run を先に流す
4. 性能上限を知るのが既定目的だとみなし、最初の sweep で ceiling 未到達なら並列数を自動で追加して続行する
5. `ceiling.status == not-reached` で最高試験点にまだ余裕があるなら、より高い並列へ伸ばして再実行する
6. run directory の artifact を確認する
7. 再現タスクなら、reference run と `phase_metrics.csv` を突き合わせてから完了扱いにする
8. artifact が `/tmp` のような repo 外にしか無い場合は、依頼がない限り `results/` 配下へ寄せてから報告する
9. 主要な throughput / latency、ceiling 到達有無、未カバー範囲を日本語で要約する

最低限確認する artifact:

- `summary.json`
- `phase_metrics.csv`
- `phase_buckets.csv`
- `raw_results.jsonl`
- `charts/*.png` があればその有無

注意:

- secret はファイルへ保存しない
- benchmark output は依頼がない限り commit しない
- GPU / power / temp の監視がない場合は `未計測` と書く
- latency spike rate の図や subplot が空なら完了扱いにしない。zero なのか描画バグなのか確認して、必要なら修正・再生成する
- 並列 60 前後でまだ余裕があるなら、そこで止めずにもっと上げて ceiling を探す
- 「同じ endpoint と model 名」であるだけでは再現扱いにしない。`request_count`、`avg_completion_tokens`、並列 sweep、監視有無まで揃える
- 重い profile を使うときは `benchmarks/securecode/scripts/run_securecode_capacity_heavy_profile.sh` を優先する
- 重い profile では軽い token cap に落とさない。`avg_completion_tokens ~= 359` を外したら別ベンチになる
- ユーザーが再利用する成果物は `results/` 配下に揃える

$ARGUMENTS
