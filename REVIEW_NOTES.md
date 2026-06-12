# Review Notes

Review-Agent 出力を残すための運用ログです。

## Latest Notes

| Date | PR/Task | Reviewer | Decision | Blocking items | Required remediation | Close status |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-06-12 | Task D2 / D2-R | qwen3.7-plus | hold | `step2_operational_stop_daily` 分岐を追加し、daily 停止ログに合わせて必須 marker を整理 | `log-only passed=true` で hold 継続。`report` 未生成は evidence 継続で再取得を試行 | open |
| 2026-06-12 | Task D3 | qwen3.7-plus | hold | report 回収が `report=missing` のまま継続し、log-only fallback でのみ成立 | report recovery 経路が継続するか、運用上 hold を許容する方針を正式化 | open |
| 2026-06-12 | Task D3-R | qwen3.7-plus | hold | D3-R で `report=missing` が継続。追跡実行で `before=20260612.log|2464710|14:06:25`→`after=20260612.log|2477438|14:18:08`、`logWindowUpdated=updated`、`passed=true` を確認 | `log-only fallback` の実績を追加。次回も missing かつ passed=true なら hold 継続、passed=false 2 回連続なら reject 条件の運用へ移行 | open |
| 2026-06-12 | Step2 gate audit follow-up | codex | hold | D2/D3 の既存 hold 証跡は旧 gate 前提。daily/monthly 固有 marker と global marker 禁止を追加し、global も `InpGlobalDDLimit=-0.0005` 固定へ戻した | D1/D2/D3 は現行 gate で再評価する。旧 `log-only passed=true` は完了判断に使わない | open |
| TBD | - | - | - | - | - | - |

## Review template

- 対象範囲: `MQL5 / Python / ドキュメント / 運用フロー`
- 重大度: `critical` / `high` / `medium` / `low`
- 検証結果: `pass` / `hold` / `reject`
- 重要修正: 事故リスク/数値安定性・ログ改変・安全ゲートの欠落

判定は `DEVELOPMENT.md` の実行証跡とリンクさせ、差し戻し時は理由と再実行条件を明記する。
