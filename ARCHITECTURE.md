# MQL5 Architecture Specification

## ファイル構成

### `Expert_Main.mq5` (メインロジック)
```cpp
class CExpertAdvisor {
  // メンバー
  CBreakoutSignal_XAUUSD  m_sig_breakout;
  CPullbackSignal_SP500   m_sig_pullback;
  CMLModel_Universal      m_sig_ml;
  CRiskManager            m_risk;
  
  // OnInit: 初期化
  void OnInit() {
    m_sig_breakout.Init(...);
    m_sig_pullback.Init(...);
    m_risk.SetMaxDD(-0.25);
  }
  
  // OnTick: メインループ
  void OnTick() {
    // 1. Signal 評価
    double breakout_signal = m_sig_breakout.Evaluate();
    double pullback_signal = m_sig_pullback.Evaluate();
    
    // 2. リスク Check (Global DD, Daily DD)
    if (!m_risk.IsHealthy()) return;
    
    // 3. ポジション管理
    if (m_risk.CanEnter() && breakout_signal > 0.7) {
      double lot = m_risk.CalculateLot();
      m_risk.PlaceOrder(ORDER_TYPE_BUY, lot, ...);
    }
    
    // 4. Trailing Stop
    m_risk.UpdateTrailingStop();
  }
};
```

### `Include/TradeLogic.mqh`
```cpp
class CBreakoutSignal_XAUUSD {
  double m_asia_high, m_asia_low;
  
  void Init() { 
    // 0-8h UTC の高値安値を事前計算
  }
  
  double Evaluate() {
    // 現在足がレンジ外か?
    // → スコア [0, 1] 返却
  }
  
  bool CheckEntry(double& entry_price, double& stop_loss) {
    // 実際のエントリー判定
    // SL計算: m_asia_low - 50pips
  }
};

class CPullbackSignal_SP500 {
  // H4/D1 EMA上昇 + M15 RSI < 40 を検出
  ...
};

class CMLModel_Universal {
  // ONNX runtime で推論
  // Input: [RSI, ATR, MACD, ...]
  // Output: [BUY_PROB, SELL_PROB]
};
```

### `Include/RiskManagement.mqh`
```cpp
class CRiskManager {
  double m_global_dd_limit;     // -25%
  double m_monthly_dd_limit;    // -20%
  double m_daily_dd_limit;      // -3%
  
  double CalculateLot() {
    // 1. Account Equity 取得
    // 2. Kelly fraction × 0.25 (Quarter Kelly)
    // 3. 日単位 DD チェック → ロット削減
  }
  
  bool IsHealthy() {
    // Global/Monthly/Daily DD のチェック
  }
  
  void PlaceOrder(...) {
    // MT5 OrderSend() ラッパー
    // Requote/Reject ハンドリング
  }
};
```

---

## データフロー (3ノード)

```
[wag-x870e] /srv/trading-data/XAUUSD/ohlc_1m.csv
  ↓ (Dukascopy downloader)
[wag-air] ← SSH pull
  ↓ (MT5 Strategy Tester input)
[wag-dell] Expert_Main.mq5 ← reads
  ↓ (backtesting log)
[wag-air] ← RDP pull
  ↓ (analysis & next iteration)
```

---

## テスト戦略

1. **ユニットテスト**: MQL5 でシグナル関数の動作確認
2. **統合テスト**: 複数シグナルの同時発火ハンドリング
3. **バックテスト**: 2023-2024 日次 (最低 2年)
4. **ペーパートレード**: 2週間 以上
5. **ライブ開始**: Quarter Kelly → 段階的増加
