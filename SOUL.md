# SOUL.md — opencode-trade 哲学＆アーキテクチャ決定

## プロジェクト理念
**目標**: AXIORY テラ口座で 24時間 安定稼働し、年 +50% リターン達成。
複数通貨ペア・複数戦略を**モジュール化**し、ロジック追加・削除を容易にする。

## コア設計原則

### 1. 戦略は相互独立
- `CBreakoutSignal_XAUUSD.mqh`
- `CPullbackSignal_SP500.mqh`
- `CMLModel_Universal.mqh`
これらは **独立したシグナル源** として実装。
同一ティックで複数シグナルが発生した場合は **リスク管理が優先度決定**。

### 2. リスク管理は絶対

Global Drawdown:  -25% (アカウント停止)
Monthly Drawdown: -20% (戦略一時停止)
Daily Drawdown:   -3%  (ロット削減)
Position Risk:    Quarter Kelly sizing

### 3. ヒストリカルデータは真実
- Dukascopy BBO + OFI (XAUUSD, EURUSD 利用可)
- TradingView 不可 (VIX は別途)
- `/srv/trading-data/SYMBOL/ohlc_1m.csv` 管理

---

## HARD_TASK 定義

以下のタスクは **GPT-5 / Codex レビュー必須**:

1. **新戦略の統合判定**
   - 既存ロジックとの相互作用設計
   - リスク曲線への影響推定

2. **MT5 Order 実行フロー**
   - Race condition / Requote handling
   - スリッページ最小化設計

3. **ONNX ML Model** 品質基準
   - バックテスト Sharpe Ratio > 1.5
   - Max Drawdown < -15%

4. **アーキテクチャ拡張**
   - 新 Include/ クラス設計
   - API境界設計 (function signatures)

---

## 決定ログ

| 決定事項 | 理由 | 決定日 |
|---------|------|--------|
| ONNX opset 17 固定 | ROCm / CUDA 互換性 | 2026-06-07 |
| Qwen3-coder 主力 | 日本語ドキュメント対応、API安定 | 2026-06-07 |
| 3ノード分散構成 | 24/7稼働 + 開発並行 | 2026-06-07 |
| CoDD + F001 | Coherence 維持、オーバーヘッド削減 | 2026-06-07 |
