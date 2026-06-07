# Research Strategy & Resource Map

## 参考URL の活用方法

### 1. **QuantConnect** (https://www.quantconnect.com)
- **用途**: XAUUSD/SP500 の **バックテスト可能ロジック** 発掘
- **検索キー**:
  - "XAUUSD Breakout"
  - "Volatility Range Trading"
  - "Machine Learning Classification"
- **抽出項目**:
  - Entry/Exit ルール（明文化）
  - Sharpe Ratio / Max Drawdown
  - 対象期間・通貨ペア
- **記録**: RESEARCH_LOG.md に URL + スクリーンショット

### 2. **Kaggle** (https://www.kaggle.com/competitions)
- **用途**: **ML モデル** の特徴量設計、データセット探索
- **検索キー**:
  - "Forex Prediction"
  - "Time Series Classification"
  - "Gold/Commodity Forecasting"
- **活用**: 上位解法の特徴量リスト → Python で再実装 → ONNX export

### 3. **MQL5 CodeBase** (https://www.mql5.com/en/code)
- **用途**: **MQL5 実装テンプレート** 、既知の EA デザインパターン
- **検索キー**: "Breakout", "Pullback", "RSI", "MACD"
- **注意**: コピペ厳禁 → 理解の上で アーキテクチャに統合

### 4. **EliteTrader, ForexFactory**
- **用途**: トレーダーの生リポート、戦略の **実戦成績**
- **活用**: 「理論上 Sharpe 1.8 → 実運用 Sharpe 0.9」 などの実態把握

### 5. **arXiv q-fin** (https://arxiv.org/list/q-fin/recent)
- **用途**: **機械学習・統計仮説** の学術的妥当性確認
- **キー**: "Volatility Prediction", "Regime Detection"

---

## リサーチ↔実装 フィードバックループ

```
Week 1:
  Research-Agent → XAUUSD "regime-switching" モデル 検索
  ↓ (論文3件、EA5個 発見)
  Hermes → 「Regime を HMM + Kalman Filter で実装」 指示

Week 2:
  Opencode → MQL5 実装開始
  Research-Agent → 平行して VIX 異常検知ロジック検索
  ↓ (実装完了、バックテスト)

Week 3:
  Hermes → 結果 (Sharpe 1.6 → 1.3 down) 分析
  Research-Agent → 「なぜ Sharpe 低下？」 再検索
  → 「News-driven gap の過大exposure」 判明
  ↓ Opencode → ニュース前 ポジション削減ロジック追加
```

---

## 検索クエリ チートシート

| 戦略 | QuantConnect | Kaggle | MQL5 |
|------|--------------|--------|------|
| Breakout | "Range + Breakout" | - | "Breakout EA" |
| Pullback | "Trend EMA" | "Classification" | "Pullback Strategy" |
| ML Model | "Neural Net" | "LSTM Forex" | - |
| Risk Mgmt | "Portfolio 5:1" | - | "Risk Manager" |
