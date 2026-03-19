# SecureCode レポート執筆メモ

このディレクトリの benchmark は、最終的な日本語レポート本文まで自動生成しない。`summary.json`、CSV、PNG を agent が読み、run ごとに人間向けの原稿を書く前提にする。目標品質は、そのまま外部共有できる benchmark メモとしての読みやすさ、密度、日本語の自然さ、画像の見せ方に置く。

## まず読むもの

- `summary.json`: モデル名、endpoint、ceiling 判定、生成時刻
- `phase_metrics.csv`: 並列ごとの req/s、p95、p99、max、success rate
- `phase_buckets.csv`: 時系列バケットの揺れ方
- `charts/*.png`: Notion にそのまま貼るグラフ
- `monitoring/` 配下の CSV: GPU / power / temp の根拠が必要なときだけ使う

## 推奨構成

benchmark メモとして読みやすくまとめるなら、構成はこの順が扱いやすい。

1. `エグゼクティブサマリ`
2. `主要メトリクス表`
3. `マシン資源表`
4. `アーティファクト一覧`
5. `グラフ`
6. `添付ファイル`
7. `考察`

`運用・販売の示唆` は、明示的に求められない限り入れない。

## 品質基準

- 最初の 30 秒で結論が分かること
- 数字が多くても読みづらくないこと
- 日本語が機械翻訳調ではなく、短く切れていること
- 表の直後に 1 段落で意味づけがあること
- グラフは単なる列挙ではなく、caption を読めば見どころが分かること
- 画像がある場合、最終出力ではファイル名だけで済ませず埋め込み表示すること
- 保存する Markdown 原稿そのものにも画像を埋め込むこと
- latency spike rate の図や subplot が空白のまま残っていないこと
- 最後に短い `考察` があり、結果の意味と今後の確認ポイントが整理されていること

## 書き方のコツ

- 1 行目の callout で結論を先に言う。
- callout は 1 文で済ませる。長くても 2 文まで。
- 「飽和開始が見えた run」か「未到達 run」かを最初に明示する。
- 数字は必ず run の実測値を書く。推測だけで `128 前後` のような値を置かない。
- 飽和を主張するなら、`edge -> fail` の throughput と p95 の変化を並べて書く。
- 未到達なら、「最高試験点でも throughput が伸び続けた」と書き、どこまで確認できたかを明示する。
- GPU / power / temp を書くのは、監視データがあるときだけにする。ない場合は `未計測` と明記する。
- 既存メモの文体は参考にしてよいが、固定の SKU、日付、価格、ホスト名、社内運用前提の文言は流用しない。
- 箇条書きは 3 本前後に絞る。多すぎる bullet は読みにくい。
- 日本語の半角スペースを濫用しない。英字や数値を含んでも自然な文にする。

## エグゼクティブサマリで最低限入れるもの

- 対象モデル名
- backing model が分かるならその識別子
- ハードウェアや配置先が分かるならその情報
- workload の種類
- 飽和開始点、または未到達であること
- 実務上の対話ラインとして無難な並列

## 主要メトリクス表で見る列

- `concurrency`
- `throughput_rps`
- `p95_latency_s`
- `p99_latency_s`
- `latency_max_s`
- `latency_over_15s_rate`

表の直後には、`どこで throughput が頭打ちになったか`、または `まだ伸びているか` を 1 段落で書く。
表は省略せず、行数が多くても全 phase を出す。

## マシン資源表で見る列

- `gpu_util_avg`
- `gpu_util_p95`
- `gpu_util_max`
- `power_draw_avg_w`
- `power_draw_max_w`
- `gpu_temp_max_c`

監視がある場合は、`GPU は 96 並列以降でほぼ張り付き` のように、負荷が上がり切る帯だけを短く要約する。
監視がない場合も表自体は残し、`n/a` と `未計測` を明示する。

## グラフ caption のコツ

- `capacity_overview.png`: throughput と latency の全体像を 1 文で説明する
- `latency_boxplot.png`: 分布がどこで広がるかを書く
- `throughput_heatmap.png`: バーストと平均 throughput の関係を書く
- `resource_spikes.png`: GPU / power / temp のスパイク秒数だと説明する

caption は長くしすぎず、グラフを読む前に見どころが分かる程度で止める。
4 枚そろっているなら、最終出力では 4 枚とも埋め込む。ファイル名だけ列挙しない。
latency spike rate が全 phase で 0 でも、図としては見える必要がある。空白に見えるなら成果物としては不十分。

## 添付ファイルの基本セット

- 日本語分析メモがあるならその Markdown
- `phase_metrics.csv`
- `phase_buckets.csv`

`summary.json` や `phase_analysis.json` は、読者向けの最終メモでは通常は添付しなくてよい。

## 考察で触れること

- どこで飽和や headroom が見えたか
- まだ不確実な点が benchmark 条件差なのか、endpoint 側の状態差なのか
- 次の run で何を揃えると判断が強くなるか

## 埋め込み表示

Codex desktop のようにローカル画像を表示できるクライアントでは、`![caption](/absolute/path.png)` の形で絶対パス埋め込みを使う。グラフ節では、caption の直後に画像を出すと読みやすい。
保存する Markdown でも同じ形を使い、レポート単体で読んでも図が見える状態にする。
