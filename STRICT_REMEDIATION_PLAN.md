# Strict Remediation Plan

`DEVELOPMENT.md` で参照される安全制約・リカバリ手順を簡潔化した運用メモです。

## 受け入れ不備時の最優先ルール

1. `full bundle` 未整合なら再配備
2. parser gate (`src/Scripts/analyze_mt5_report.py`) で `passed=false` を出した場合は merge/progress 停止
3. 重大な拒否ルール（No money / margin / invalid stops / order rejection / JPY risk breach / global stop 後注文）がある場合は原因解消まで候補進行停止
4. `backtest/results/` に証跡を残す

## リメディエーション手順

- 根因を 1件ずつ明文化（ログ参照・シナリオ・再現条件）
- 対応候補を最小差分で切り分けて再実行
- 再実行成功後にのみ次フェーズへ進む
- ログと parser 出力から不一致や推定値が外れる場合は直ちにレビューへ連携

## 例外

- live trading 有効化を前提とした例外承認は原則不可
- 既存の `EA_TRADING_PLAN.md` / `FINAL_IMPLEMENTATION_PLAN.md` の NO-GO 条件を上書きしない
