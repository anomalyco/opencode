# opencode-trade Context Mode PR 提出例

以下は review 時にそのまま貼れる提出用本文です。

```markdown
## Summary

- [x] `.opencode/plugins/trade-context-mode.ts` を追加・更新し、`off / tools / shadow` のみを扱う。
- [x] delegate import 失敗時の fail-open 化を確認。
- [x] `ctx_` ツール監査（malformed tool の除外）を追加。

## Changes

- Add/Update: `.opencode/plugins/trade-context-mode.ts`
- Update: `packages/opencode/test/plugin/trade-context-mode.test.ts`
- Add fixture: `packages/opencode/test/fixture/trade-context-mode-delegate-invalid-tool-plugin.ts`
- Docs:
  - `docs/opencode-trade-context-mode-review-checklist.md`
  - `docs/opencode-trade-context-mode-pr-template.md`

## Verification

- [x] `cd packages/opencode && bun test test/plugin/trade-context-mode.test.ts`
  - 結果: `25 pass`
- [x] `cd packages/opencode && bun test test/plugin/loader-shared.test.ts test/plugin/trade-context-mode.test.ts`
  - 結果: `53 pass`
- [x] rollback 検証（`OPENCODE_TRADE_CONTEXT_MODE=off`）

## Risk / Rollback

- 既知制約: context-mode 本体依存は未導入（PoC）
- Rollback 手順:
  - `OPENCODE_TRADE_CONTEXT_MODE=off`
  - 必要なら `OPENCODE_PURE=1`

## Notes

- on / strict は現時点 off 相当として扱い、delegate import しない。

## Attachments

- `docs/opencode-trade-context-mode-review-checklist.md`
- `docs/opencode-trade-context-mode-pr-template.md`

## PR提出前最終チェック

- [x] `docs/opencode-trade-context-mode-review-checklist.md` を同梱し、全項目を確認済みとして埋めた。
- [x] `PR本文（コピペ例）` を同じく埋め、Verification を完了した。
- [x] rollback 手順を明記した。
```

## 参照

- 運用フロー: `docs/opencode-trade-context-mode-plan.md`
- チェックリスト: `docs/opencode-trade-context-mode-review-checklist.md`
- テンプレ: `docs/opencode-trade-context-mode-pr-template.md`
