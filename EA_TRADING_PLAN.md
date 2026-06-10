# EA Trading Plan

## 位置付け
- この文書は、EA の取引思想、採用戦略、実装優先順位、検証ゲートを統合した canonical plan。
- SentinelBreakout の実装詳細は `SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md` を参照する。
- 矛盾した場合の優先順位は次のとおり。
- 1. この文書の最新状態
- 2. `SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md`
- 3. `FINAL_IMPLEMENTATION_PLAN.md`
- 4. `STRATEGY_ADOPTION_PLAN.md`
- 5. `SOUL.md`

## 目標
- AXIORY 口座で 24 時間安定稼働できる EA を作る。
- 破滅回避を最優先にし、その上で中長期で年率 `+50%` を狙う。
- 通常の研究、実装、検証、失格判定は半自動化し、人間は例外承認に集中する。

## 最上位ルール
- Safety Gate first. Strategy second. ML last.
- live trading は Critical gate 完了まで `NO-GO`。
- 不明な状態では新規エントリーせず fail-close で止まる。
- 戦略クラスはシグナル生成のみを担当し、注文執行はしない。
- 複数戦略の同時本番投入は、各戦略が単体ゲートを通過した後に限る。
- `fresh system` は EA 全廃ではなく、`fresh strategy module + fresh execution boundary + existing safety foundation` を意味する。

## 継承する安全基盤
- `RiskManagement.mqh` の Risk V3 と operational stop state は継承する。
- MT5 report / tester log parser と gate 判定は継承する。
- B1 one-bar confirmation 不合格証跡は削除せず継承する。
- GUI export を含む report 回収運用知見は継承する。
- 既存の不具合知見、特に `Invalid stops` と CLI report 未生成問題は未解決課題として継承する。

## 成功条件
- 自動停止が効く。
- lot 計算が安全で一貫している。
- report と log から pass / fail JSON を自動生成できる。
- 候補戦略は out-of-sample と walk-forward を含む gate を通過してから昇格する。
- 注文拒否、margin 異常、SL/TP 異常、skip 理由が log で追跡できる。

## リスク管理
- Global Drawdown: `-25%` で全停止。
- Monthly Drawdown: `-20%` で戦略停止。
- Daily Drawdown: `-3%` で lot 削減または停止。
- Position Risk: Quarter Kelly 相当の保守的 sizing を前提にする。
- `RiskManagement.mqh` が EA の最優先コンポーネント。

## 戦略ポートフォリオ
### B1: XAUUSD breakout
- 採用する。
- 役割は短期収益候補兼、MT5 執行基盤の検証対象。
- ただし現行 `TradeLogic.mqh` one-bar confirmation candidate は不合格として固定する。

### SentinelBreakout_XAUUSD_M15
- 採用する。
- 役割は B1 V2 候補。
- 既存 B1 を延命するのではなく、新しい strategy module と execution boundary で再設計する。
- 実装着手前に execution hygiene を先行させる。

### B2: SP500 pullback
- 採用する。
- 役割は独立戦略、または breakout / ONNX の補助フィルター。
- 確定足のみを参照する。shift `0` は禁止。

### B8: normalized ONNX
- 採用する。
- 役割は中期本命のモデル更新基盤。
- raw OHLC は使わない。
- 本番モデルへの自動昇格は禁止。

### B7: web research pipeline
- 条件付き採用。
- Research-Agent の仮説探索専用。
- 自動実装、自動本番投入、自動パラメータ反映は禁止。

### B6: blind continuous learning
- 不採用。
- `Gated Continuous Learning` に置き換える。

## 現在の実装状態
- `Expert_Main.mq5` は breakout-only validation flow。
- Risk V3 safety gate と operational risk stop は導入済み。
- parser による MT5 report / log gate は利用可能。
- `TradeLogic.mqh` one-bar confirmation candidate は検証済みで正式に不合格。
- `EA_TRADING_PLAN.md` と `SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md` を今後の正本とする。

## B1 の現状判定
### 判定
- `TradeLogic.mqh` の one-bar confirmation breakout candidate は不合格。

### 不合格理由
- Profit Factor: `0.78`
- Sharpe Ratio: `-5.0`
- Equity Drawdown Relative: `25.39%`
- Net Profit: `-1534.77`
- Total Trades: `231`
- Win Rate: `29.44%`

### 証跡
- `backtest/results/breakout_confirmed_202406_202412.json`
- commit: `test(core): record rejected breakout confirmation backtest`

### 取り扱い
- B1 one-bar confirmation は validated candidate に昇格しない。
- `TradeLogic.mqh` の次候補は最大 2 案までに絞る。
- 今回の主対象は B1 改良継続ではなく SentinelBreakout と execution hygiene。

## 検証ゲート
### 共通ゲート
- Sharpe Ratio `> 1.5`
- Max Drawdown `< 15%`
- Profit Factor `> 1.2`
- margin error、多発する注文拒否、異常 lot は即失格
- `No money`、`Invalid stops`、missing required marker は即失格
- 極端な All-Buy / All-Sell / Hold-only は即失格
- out-of-sample 必須
- walk-forward 必須

### 本番昇格ゲート
- backtest 合格
- forward / paper 合格
- 既存本番より drawdown 特性が悪化していない
- rollback 先が常に残っている

## 開発フェーズ
### Phase 0: 方針固定
- SentinelBreakout を B1 V2 候補として明文化する。
- `fresh strategy module + fresh execution boundary + existing safety foundation` を固定する。
- 既存 B1 は rejected candidate として閉じる。

### Phase 1: Execution Hygiene 設計
- `BrokerSymbolProfile` と `TradeExecutor` の責務を定義する。
- broker metadata logging、price / SL / TP normalization、spread validation、skip reason logging を設計する。
- `Evaluate()` と `CheckEntrySignal()` の二重評価を解消方針として固定する。

### Phase 2: Parser Gate 拡張
- Sentinel 専用 scenario と required markers を追加する。
- skipped trade reason count、order rejection count、JPY risk breach count を gate 化する。
- missing log window 時は安全側 fail を維持する。

### Phase 3: Execution Boundary 実装
- `BrokerSymbolProfile.mqh` を追加する。
- `TradeExecutor.mqh` を追加する。
- `RiskManagement.mqh` は lot、risk state、execution pre-check の責務に集中させる。

### Phase 4: SentinelBreakout Signal 実装
- `SentinelBreakout_XAUUSD_M15.mqh` を追加する。
- M15 closed bars only、breakout、ATR、EMA、session、overextension、one-trade-per-day を実装する。
- Signal class に order execution を入れない。

### Phase 5: Expert 統合
- `Expert_Main.mq5` に Sentinel validation mode を追加する。
- 既存 B1 と Sentinel を同時稼働させない。
- risk state を最優先に評価する。

### Phase 6: Safety Smoke Test
- JPY `100k / 300k / 500k` で safety-only scenario を回す。
- `Invalid stops = 0`、`No money = 0`、margin error `0` を確認する。
- この phase では profit 最適化をしない。

### Phase 7: Backtest Matrix
- 2023、2024、2025、2026 YTD、直近 6 か月、2 年連続、out-of-sample、walk-forward を回す。
- EMA100 / EMA200、overextension on / off を比較する。
- production 候補は risk `0.25%` を主とし、`0.5%` は research only にする。

### Phase 8: 判定
- pass / fail JSON を記録する。
- validated candidate、hold、rejected candidate のどれかに固定する。
- 不合格なら rejection reason を commit して閉じる。

## 実装順の推奨
- 1. 先に `BrokerSymbolProfile` と `TradeExecutor` の境界を固める。
- 2. 次に parser / gate を Sentinel 前提に拡張する。
- 3. その後に Sentinel signal を実装する。
- 4. 収益改善やパラメータ調整は safety smoke test 後に回す。
- 5. 1 回の実装タスクは原則 1 phase 以内に閉じる。
- 6. HARD_TASK に当たる order execution flow と新 Include 設計は実装後レビューを必須にする。

## 当面の意思決定
- B1 は本命ではなく、失格として閉じた候補とする。
- 新しい収益ロジック探索より、EA 構造と執行品質の改善を優先する。
- Sentinel 実装前に `Invalid stops` 系の execution hygiene を潰す。
- fresh report と tester log の回収手順を今後も固定する。

## 未解決課題
- MT5 CLI `Report=` の fresh report 未生成問題。
- `Invalid stops` の完全解消。
- stop level / freeze level と broker 差異の吸収。
- requote 時の再計算ポリシー。
- Sentinel 用 parser metrics と required markers の追加。

## 参照元
- `SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md`
- `FINAL_IMPLEMENTATION_PLAN.md`
- `STRATEGY_ADOPTION_PLAN.md`
- `SOUL.md`
- `ARCHITECTURE.md`
- `backtest/results/breakout_confirmed_202406_202412.json`
