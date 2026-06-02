---
name: securecode-report
description: Write a Japanese SecureCode benchmark report from an existing run directory
---

`benchmarks/securecode/REPORT_AUTHORING_TIPS.md` を最初に読み、その後で `$ARGUMENTS` が指す run directory の artifact を確認すること。

やること:

1. 対象 run directory を決め、既定では `results/` 配下を正本にする
2. `/tmp` など repo 外にしか無い run を使う場合は、依頼がない限り `results/` 配下へ寄せてから作業する
3. `summary.json`、`phase_metrics.csv`、`phase_buckets.csv`、`charts/*.png` を読む
4. 実測値だけを使って、読みやすく密度の高い日本語の最終レポートを書く
5. callout、表の後ろの短い解釈、4 枚のグラフ caption、画像の埋め込み、添付一覧まで含めて、そのまま共有できる benchmark メモとして読みやすく仕上げる
6. 明示要求がない限り `運用・販売の示唆` は入れない
7. 既定では canonical な run directory に `securecode-capacity-ceiling-analysis-YYYYMMDD.ja.md` を保存する
8. 画像がある場合は保存する Markdown 自体にも、最終出力にも絶対パスで埋め込み表示する
9. 保存後に Markdown を読み返し、画像パスと添付リンクが実在する `results/` 側を向いているか確認する
10. 保存した内容と根拠に使った run directory を日本語で要約する
11. レポートの最後に `考察` セクションを置き、何が再現できて何が未再現かを短く整理する

推奨構成:

1. `エグゼクティブサマリ`
2. `主要メトリクス表`
3. `マシン資源表`
4. `アーティファクト一覧`
5. `グラフ`
6. `添付ファイル`
7. `考察`

注意:

- 飽和点は観測できたときだけ書く
- 監視がない項目は `未計測`
- `capacity_overview.png` / `latency_boxplot.png` / `throughput_heatmap.png` / `resource_spikes.png` の 4 種は、あるなら全部使う
- latency spike rate の図や subplot が空なら、そのまま流さない。zero なのか描画不具合なのか確認する
- 既存メモの文体は参考にしてよいが、固定の環境値や社内前提の文言は流用しない
- canonical な成果物が `results/` にあるのに、Markdown の画像パスだけ `/tmp` を向く状態を残さない

$ARGUMENTS
