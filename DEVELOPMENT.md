# Development Workflow

## 環境構築

### [Node 1] wag-air (Mac)
```bash
git clone https://codeberg.org/wag/opencode-trade.git
cd opencode-trade
mkdir -p /Users/wag/ea/opencode-trade/{src,backtest,logs}
```

### [Node 2] wag-x870e (Ubuntu)
```bash
# Tailscale SSH で接続
ssh wag-x870e "mkdir -p /srv/trading-data/{XAUUSD,SP500,JPYUSD,EURUSD}"

# Python environment
python3.10 -m venv /srv/trading-env
source /srv/trading-env/bin/activate
pip install pandas numpy requests yfinance onnxruntime

# Dukascopy data downloader
git clone https://github.com/wag/dukaspy.git
# or use custom data_collector_SYMBOL.py (below)
```

### [Node 3] wag-dell (Windows11)
```cmd
# MT5 Expert Install path
C:\Program Files\Alpari Limited\MetaTrader 5\MQL5\Experts\opencode-trade\

# Python bridge for ONNX inference
cd C:\dev\opencode-trade-bridge
py -3.10 -m venv venv
pip install onnxruntime redis
```

---

## タスク実行フロー

### 例: XAUUSD 用 BreakoutSignal 実装

1. **Hermes が指示書作成** (日本語)

```
【タスク】 XAUUSD Breakout Signal 実装
■ 要件
  - アジア時間(0-8h UTC) の高値安値を記録
  - 8h以降のブレイクアウトで順張りエントリー
  - 参考: MQL5 CodeBase "4-hour breakout EA"

■ 出力
  - Include/SignalBreakout_XAUUSD.mqh
  - ユニットテスト: backtesting/test_breakout_xauusd.mq5

■ 期限: 6/10 23:59 UTC
```

2. **Opencode-Agent が実装**
   - Opencode → qwen3-coder で MQL5 コード生成
   - → git commit `[TASK] SignalBreakout | XAUUSD | Asia session HLR`
   - → push to feature/breakout-xauusd

3. **Research-Agent が参考資料検索** (並行)
   - Hermes → "QuantConnect で XAUUSD breakout の事例検索"
   - → ページ抽出、Sharpe/Drawdown 記録
   - → RESEARCH_LOG.md 更新

4. **Review-Agent が承認**
   - GLM-5 → Division by zero, Array bounds check
   - → OK なら「APPROVED」コメント

5. **バックテスト実行** (wag-dell)
   - MT5 Strategy Tester で 2023-2024 日次実行
   - → backtesting/results/breakout_xauusd_20240101.json
   - → Sharpe, Drawdown, Win% を SPRINT.md に記録

---

## 定期メンテナンス (毎日)

- **09:00 UTC**: Hermes が日中の新リサーチ結果をスキャン
- **18:00 UTC**: Opencode 実装進捗を確認、ボトルネック排除
- **22:00 UTC**: wag-dell MT5 バックテスト完了確認、ログ保存
