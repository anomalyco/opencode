# Remote MT5 Compile + Smoke Runbook

この runbook は `DEVELOPMENT.md` で参照される、MT5 側の最終実行手順を1か所に集約します。

## 事前確認

- `wag-dell` 側で MT5/MetaEditor を起動可能な状態か
- 最新の EA/Bundle が full sync されていること
- 依存 include ファイル（`src/Include/*.mqh`）の更新有無を確認

## 手順

1. Windows 側の MT5 プロジェクトに以下を全量配置
   - `src/Expert_Main.mq5`
   - `src/Include/BrokerSymbolProfile.mqh`
   - `src/Include/TradeExecutor.mqh`
   - `src/Include/RiskManagement.mqh`
   - `src/Include/TradeLogic.mqh`
   - `src/Include/DataFeed.mqh`
   - `backtest/gate_config.json`
   - `backtest/tester/*.ini`
2. MetaEditor で `Expert_Main.mq5` をコンパイル
   - 期待: `0 errors, 0 warnings`
3. Strategy Tester で smoke 実行
   - 最低 1 ケースでコンパイル済み ex5 を実行
4. テスター結果を収集
   - log（ログ）
   - report（HTML）
5. 取得ログを parser にかける

```bash
python3 src/Scripts/analyze_mt5_report.py \
  --log <tester-log-path> \
  --report <report-html-path> \
  --scenario <scenario-name> \
  --config backtest/gate_config.json \
  --out <out-json-path>
```

## 合否判定

- `passed` が `true` なら次工程へ進行
- `passed` が `false` の場合は、`failed_rules` を確認して `DEVELOPMENT.md` の根拠保存ルールに従い修正

## 失敗時の共通扱い

- include 変更時は single-file sync をしない（常に全ファイル再配備）
- report/log が不在または parser が失敗する場合はその候補を merge/progress 対象から除外
