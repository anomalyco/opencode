# SentinelBreakout Implementation Plan

## 目的
- `SentinelBreakout_XAUUSD_M15` を B1 V2 候補として設計、実装、検証する。
- 現行 B1 の失敗を繰り返さないため、strategy より先に execution hygiene を固める。
- 実装モデルは `gpt-5.4 reasoning medium` を前提とする。

## 非目標
- 既存 EA を丸ごと捨てること。
- B1 one-bar confirmation を再延命すること。
- 収益最適化を safety hardening より先に進めること。

## 前提
- `RiskManagement.mqh` の Risk V3 と operational stop state は継承する。
- parser / gate は継承しつつ Sentinel 向けに拡張する。
- 注文執行は signal class から分離する。
- live trading は引き続き `NO-GO`。

## アーキテクチャ方針
- `Expert_Main.mq5`: orchestration のみ。
- `SentinelBreakout_XAUUSD_M15.mqh`: signal evaluation のみ。
- `BrokerSymbolProfile.mqh`: broker / symbol metadata の取得と妥当性確認。
- `TradeExecutor.mqh`: order request 構築、price / SL / TP 正規化、送信、retcode logging。
- `RiskManagement.mqh`: risk sizing、drawdown state、execution pre-check の統括。

## Phase 0: 方針固定
### 目的
- 実装境界を固定し、何を捨てて何を継承するかを明文化する。

### 作業
- `EA_TRADING_PLAN.md` に Sentinel を B1 V2 候補として反映する。
- `fresh strategy module + fresh execution boundary + existing safety foundation` を正本化する。
- 既存 B1 one-bar confirmation を rejected candidate として閉じる。

### 完了条件
- Sentinel が主対象であることが文書上で明確。
- 既存 B1 の扱いが曖昧でない。

## Phase 1: Execution Hygiene 設計
### 目的
- `Invalid stops` と注文拒否の主要原因を strategy 実装前に潰す。

### 対象ファイル
- `src/Include/RiskManagement.mqh`
- 新規 `src/Include/BrokerSymbolProfile.mqh`
- 新規 `src/Include/TradeExecutor.mqh`

### 作業
- broker metadata logging 仕様を決める。
- price / SL / TP normalization 仕様を決める。
- stop level / freeze level validation 仕様を決める。
- spread validation 仕様を決める。
- requote 時の entry / SL / TP 再計算方針を決める。
- skipped trade reason logging を列挙する。

### 実装順の推奨
- 1. `BrokerSymbolProfile` が返す metadata 一覧を固定する。
- 2. `TradeExecutor` の public API を先に決める。
- 3. 最後に `RiskManagement.mqh` 側の呼び出し地点を合わせる。

### 完了条件
- order 前 validation 項目が固定されている。
- skip された理由を log で追える。

## Phase 2: Parser Gate 拡張
### 目的
- Sentinel の安全性と失敗様式を parser で自動判定できるようにする。

### 対象ファイル
- `src/Scripts/analyze_mt5_report.py`
- `src/Scripts/tests/test_analyze_mt5_report.py`
- `backtest/gate_config.json`

### 作業
- Sentinel scenario を追加する。
- required markers に strategy version と broker metadata marker を追加する。
- skipped trade reason count を追加する。
- order rejection count を追加する。
- JPY risk breach count を追加する。
- `Invalid stops` count を明示失格条件にする。

### 実装順の推奨
- 1. log marker 名を先に固定する。
- 2. parser 実装前に gate_config の scenario 名と required markers を定義する。
- 3. parser 実装後にテストを足す。

### 完了条件
- Sentinel 用 pass / fail JSON を安定生成できる。
- missing marker と order rejection を自動失格にできる。

## Phase 3: BrokerSymbolProfile 実装
### 目的
- broker / symbol 前提を EA 起動時に固定取得し、曖昧なら fail-close する。

### 対象ファイル
- 新規 `src/Include/BrokerSymbolProfile.mqh`
- `src/Expert_Main.mq5`

### 作業
- account currency を取得する。
- symbol alias と digits、point を取得する。
- spread、stop level、freeze level を取得する。
- volume min / max / step を取得する。
- tick size、tick value、contract size を取得する。
- metadata marker を log に出す。

### 実装順の推奨
- 1. read-only getter を先に実装する。
- 2. validate 関数を後から追加する。
- 3. `OnInit()` で失敗時停止をつなぐ。

### 完了条件
- metadata 欠損時は新規 entry 不可。
- log から symbol / account 前提を parser で拾える。

## Phase 4: TradeExecutor 実装
### 目的
- 注文送信を signal と risk から切り離し、執行品質を単独で監査できるようにする。

### 対象ファイル
- 新規 `src/Include/TradeExecutor.mqh`
- `src/Include/RiskManagement.mqh`

### 作業
- order request 構築を分離する。
- SL / TP の正規化を行う。
- stop / freeze level を検証する。
- spread 上限を検証する。
- margin を検証する。
- retcode と skip reason を logging する。
- requote 時に価格と SL / TP を再計算する。

### 実装順の推奨
- 1. pure validation 関数群を先に置く。
- 2. 次に request builder を実装する。
- 3. 最後に send / retry / logging をつなぐ。

### 完了条件
- `Invalid stops` を事前 skip できる。
- order failure 理由が log で分類される。

## Phase 5: SentinelBreakout Signal 実装
### 目的
- B1 V2 候補の signal を既存 breakout ロジックから独立実装する。

### 対象ファイル
- 新規 `src/Include/SentinelBreakout_XAUUSD_M15.mqh`

### 作業
- M15 closed bars only を徹底する。
- previous 20-bar high / low breakout を使う。
- H1 EMA100 / EMA200 filter を切替可能にする。
- ATR14 minimum filter を入れる。
- overextension filter を入れる。
- JST `16:00-25:00` session を扱う。
- 1 日 1 trade 制限を入れる。
- 同方向重複 entry を防ぐ。
- no-trade window input を用意する。

### 実装順の推奨
- 1. signal 判定だけを返す最小版を作る。
- 2. その後フィルターを段階追加する。
- 3. session と one-trade-per-day は最後に結合する。

### 完了条件
- signal class は direction / entry intent だけ返す。
- shift `0` を使わない。
- order execution を含まない。

## Phase 6: Expert_Main 統合
### 目的
- Sentinel を breakout-only validation flow に安全に差し込む。

### 対象ファイル
- `src/Expert_Main.mq5`

### 作業
- Sentinel validation mode input を追加する。
- 既存 B1 と Sentinel を同時稼働させない。
- `Evaluate()` と `CheckEntrySignal()` の二重評価を解消する。
- risk state を最優先で判定する。
- `BrokerSymbolProfile` 初期化失敗時は即停止する。

### 実装順の推奨
- 1. 新 mode input を追加する。
- 2. signal 呼び出しを単一路線に整理する。
- 3. 既存 B1 flow と干渉しないことを最後に確認する。

### 完了条件
- Sentinel 単体検証が可能。
- compile が `0 errors, 0 warnings`。

## Phase 7: Safety Smoke Test
### 目的
- 収益性を見る前に安全に動くことを確認する。

### 対象
- `backtest/tester/`
- `backtest/results/`

### 作業
- JPY `100k / 300k / 500k` scenario を作る。
- minimum lot risk skip を確認する。
- `Invalid stops = 0` を確認する。
- `No money = 0` を確認する。
- margin error `0` を確認する。
- required markers を確認する。

### 実装順の推奨
- 1. まず `100k` で fail-close 動作を見る。
- 2. 次に `300k` で baseline lot の安定性を見る。
- 3. 最後に `500k` で lot step と margin を見る。

### 完了条件
- 全資本 scenario で safety gate を通過する。
- trade 数が少なくても safety pass を優先する。

## Phase 8: Backtest Matrix
### 目的
- Sentinel 候補の統計的有効性を区間依存なしで確認する。

### 作業
- `2023 full year`
- `2024 full year`
- `2025 full year`
- `2026 YTD`
- `latest 6 months`
- `2-year continuous`
- `out-of-sample split`
- `walk-forward split`
- `EMA100 vs EMA200`
- `overextension on / off`

### 実装順の推奨
- 1. 固定パラメータで long horizon を先に回す。
- 2. その後に EMA と overextension の比較を行う。
- 3. 閾値調整は最後まで後回しにする。

### 完了条件
- PF `> 1.2`
- Sharpe `> 1.5`
- Max DD `< 15%`
- production 候補では Max DD `< 10%` を目標にする。

## Phase 9: 判定
### 目的
- Sentinel を昇格、保留、不合格のどれかに固定する。

### 作業
- pass / fail JSON を記録する。
- rejection reason を記録する。
- validated candidate か rejected candidate かを明記する。
- 次候補を増やす場合は最大 2 案までに絞る。

### 完了条件
- 合格なら paper 候補。
- 不合格なら証跡 commit で閉じる。
- 保留なら追加データ条件を明記する。

## 1 Phase ごとの実装単位
- `gpt-5.4 reasoning medium` には 1 回のタスクで 1 phase 以内を割り当てる。
- phase を跨ぐ変更は原則禁止する。
- parser 変更と MQL5 執行変更は同一 commit に混ぜない。
- compile / test / backtest 証跡が出ない phase は完了扱いにしない。

## レビュー必須ポイント
- `TradeExecutor` の order flow。
- `BrokerSymbolProfile` の fail-close 条件。
- `RiskManagement.mqh` との責務分離。
- Sentinel signal と既存戦略との境界。

## 最初の実装順
- 1. Phase 2: parser marker と gate config を先に固定する。
- 2. Phase 3: `BrokerSymbolProfile` を作る。
- 3. Phase 4: `TradeExecutor` を作る。
- 4. Phase 6 の一部として `Expert_Main.mq5` の二重評価を解消する。
- 5. Phase 5: Sentinel signal を実装する。
- 6. Phase 7 以降で safety smoke test と backtest matrix に進む。

## 判定ルール
- safety smoke test を通るまでは収益議論をしない。
- `Invalid stops`、`No money`、missing marker が 1 件でも出たら先に執行品質へ戻る。
- B1 の不合格理由と同型の悪化が出た場合は即 rejected candidate を検討する。
