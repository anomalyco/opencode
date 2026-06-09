# Strategy Adoption Plan

## 目的
- 24時間の安定運用を優先する。
- 大手業者がやりにくい、小回りの利く自律改善パイプラインを作る。
- 負けないことを「破滅しないこと」「異常時に自動停止できること」で定義する。
- 人間の手を減らし、Research-Agent と EA が自己判断できる範囲を広げる。

## 採用結論

### 1位: B8 正規化ONNX + 厳格な検証ゲート自動学習
- 採用する。
- ただし本番ONNXへの自動昇格は禁止する。
- 役割は中期本命のモデル更新基盤とする。
- 入力は raw OHLC を禁止し、log return、ATR比、z-score、RSI、MACD、HMA などの正規化特徴量に限定する。

### 2位: B1 時間帯依存型ボラティリティブレイクアウト
- 採用する。
- 役割は短期の収益源候補兼、MT5執行基盤の土台とする。
- まず XAUUSD breakout を継続改善し、安定した lot 計算、配布、backtest 手順を固める。

### 3位: B2 マルチタイムフレーム押し目買い
- 採用する。
- 役割は SP500 向け独立戦略、または breakout / ONNX のフィルターとする。
- 確定足のみを参照し、未形成バー依存を禁止する。

### 4位: B7 Webスクレイピングによる自律的戦略探索
- 条件付きで採用する。
- 役割は Research-Agent の仮説探索に限定する。
- 自動実装、自動本番投入、自動パラメータ反映は禁止する。

### 5位: B6 無条件の自動再学習・デプロイ
- そのままでは採用しない。
- `Blind Continuous Learning` を `Gated Continuous Learning` に置き換えて採用する。
- 自動化の対象は候補モデル生成までとし、本番昇格はゲート通過後のみ許可する。

## 全体アーキテクチャ

### EA 側の原則
- OnTick 内で外部 LLM API を呼ばない。
- EA はシグナル評価、リスク管理、注文執行、停止判断に専念する。
- 不明な状態では取引を増やさず、fail-close で止まる。

### Agent 側の原則
- Research-Agent は論文、CodeBase、事例から仮説を収集する。
- Opencode-Agent は MQL5 / Python 実装案を作る。
- Review-Agent は数値安定性、レース条件、破滅リスクを落とす。
- 人間は例外承認と優先順位変更だけを担当する。

## 実行フェーズ

### Phase 1: B1 の安定化
- XAUUSD breakout の 1本確認後エントリーを6ヶ月で再検証する。
- `RiskManagement.mqh` の安全な lot 計算を git 管理下で再確立する。
- stale include、`No money`、過大 lot を再発防止対象にする。
- HTML report と tester log の回収手順を固定化する。

### Phase 2: B2 の追加
- SP500 向け pullback を独立戦略として実装する。
- 上位足 EMA と下位足 RSI を確定足ベースで評価する。
- breakout と同一口座で干渉させる前に単体検証を終える。

### Phase 3: B8 の学習パイプライン
- Python 側で学習、推論、特徴量作成、評価を分離する。
- ONNX export は opset 17 固定とする。
- MT5互換の簡易検証器、または MT5 tester 連携で候補モデルを評価する。

### Phase 4: B7 による仮説探索
- Research-Agent が定期的に QuantConnect、Kaggle、MQL5 CodeBase、arXiv を巡回する。
- 生成物は `hypothesis -> expected edge -> required data -> rejection reason` のカード形式にする。
- 良案だけを B1/B2/B8 の改善候補へ流す。

### Phase 5: Gated Continuous Learning
- 再学習ジョブは候補モデルを `candidate` として保存する。
- `candidate` は backtest、walk-forward、shadow の順で昇格審査する。
- 現行本番モデルを直接上書きしない。
- 異常時は自動で前バージョンへ rollback する。

## 検証ゲート

### 共通ゲート
- Sharpe Ratio `> 1.5`
- Max Drawdown `< 15%`
- Profit Factor `> 1.2`
- 極端な All-Buy / All-Sell を検出した場合は即失格
- margin error、注文拒否多発、異常 lot は即失格
- out-of-sample を必須にする
- walk-forward を必須にする

### 本番昇格ゲート
- backtest 合格
- forward / paper 合格
- 既存本番より drawdown 特性が悪化していない
- rollback 先モデルが常に残っている

### 運用停止ゲート
- Global Drawdown: `-25%` で全停止
- Monthly Drawdown: `-20%` で戦略停止
- Daily Drawdown: `-3%` で lot 削減または停止
- データ欠損、指標壊れ、推論失敗時は新規エントリー停止

## 自己監査

### 安定運用
- 合格。
- 理由: EA の意思決定を MT5 内に閉じ、外部 AI は非同期研究と検証に限定している。

### 大手業者ができないこと
- 合格。
- 理由: 小規模な環境で、Research-Agent、EA、検証ゲート、モデル更新を一体運用できる。

### 負けないこと
- 条件付き合格。
- 理由: 勝率保証は不可能だが、破滅回避、停止、rollback を設計に入れている。

### 人間の手を減らすこと
- 合格。
- 理由: 人間は最終例外承認に寄せ、通常の探索、学習、候補比較、停止判断は自動化する。

### B6 の安全性
- 不合格のまま採用しない。
- 理由: 無条件デプロイは既知の All-Buy 崩壊、過学習、壊れたデータ流入に耐えない。
- 対策: `Blind Continuous Learning` を廃止し、`Gated Continuous Learning` に置き換える。

### 現在のコード状態との整合
- 条件付き合格。
- 理由: B1 は既に部分実装済みだが、B2/B8/B7/B6 はまだ運用設計中心であり、即本番化できる状態ではない。

## 次アクション
- `TradeLogic.mqh` の 1本確認後エントリーを6ヶ月 backtest で再評価する。
- `RiskManagement.mqh` の本番安全版を再度 git に戻す前提で差分整理する。
- SP500 pullback の最小実装要件を定義する。
- Python 側に正規化特徴量と検証ゲートの雛形を追加する。
- Research-Agent 用の仮説カード運用を始める。

## 不採用案の扱い
- B6 の無条件自動デプロイは不採用のまま固定する。
- B5 の LLM Orchestrator は OnTick への直接介入を不採用とし、研究補助用途のみに限定する。
- B4 の raw OHLC ONNX は不採用とする。
- B3 の巨大 if-else 自動生成は不採用とする。
