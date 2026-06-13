# opencode-trade Context Mode PR テンプレート

## 概要

- 目的: `context-mode` を無害な wrapper で PoC 検証し、`trade-memory` と衝突しない最小 hook 絞り込みを確立
- 範囲: `.opencode/plugins/trade-context-mode.ts` と plugin テスト一式

## 変更点（簡潔）

- 追加: `.opencode/plugins/trade-context-mode.ts`（`off / tools / shadow` のみ）
- ハードニング: `tool` 定義と `tool.execute.after` の非関数・不正値ガード
- テスト追加: `packages/opencode/test/fixture/trade-context-mode-delegate-invalid-tool-plugin.ts`
- テスト更新: `packages/opencode/test/plugin/trade-context-mode.test.ts`
- レビュー資料: `docs/opencode-trade-context-mode-review-checklist.md`

## 完成提出例

- `docs/opencode-trade-context-mode-pr-ready-example.md` に、添付情報を埋めたまま提出できる最終本文の完成形があります。


## 行った確認

- `bun test test/plugin/trade-context-mode.test.ts`
- `bun test test/plugin/loader-shared.test.ts test/plugin/trade-context-mode.test.ts`

## レビュー観点

- `OPENCODE_TRADE_CONTEXT_MODE` 未実装値（`on` / `strict`）は `off` フォールバックで delegate import しない
- `tools`: `ctx_` ツールのみ、かつ tool 定義が正常なものだけ露出
- `shadow`: `tool.execute.after` は fail-open（例外を上位へ伝播しない）
- 破損 delegate でも起動継続

## 監査観点チェック

- 既存 workflow の停止がないか（`trade-memory` と衝突しないか）
- `off` モードでの即時 rollback が可能か（必要なら `OPENCODE_PURE=1`）

## 添付

- `docs/opencode-trade-context-mode-review-checklist.md`
- 重要ログ: test 実行結果（pass lines）
- 既知制約: 本体 `context-mode` 依存追加は未実施（PoC 導入のみ）

## PR本文（貼り付け用）

- 対象機能: `off / tools / shadow` の context-mode wrapper PoC
- 変更: `.opencode/plugins/trade-context-mode.ts`
- テスト: plugin 側の PoC 監査テストを更新
- 目的: `trade-memory` と衝突しない最小 hook 絞り込み

### Summary

- 変更内容:
  - [ ] `.opencode/plugins/trade-context-mode.ts` の追加・更新
  - [ ] `tool` 定義/`tool.execute.after` の不正値ガード
  - [ ] malformed `ctx_` tool 監査
- 設定値:
  - `OPENCODE_TRADE_CONTEXT_MODE`（`off / tools / shadow`）
  - `OPENCODE_TRADE_CONTEXT_MODE_DELEGATE`（`tools` / `shadow`）

### Verification

- [ ] `cd packages/opencode && bun test test/plugin/trade-context-mode.test.ts`
- [ ] `cd packages/opencode && bun test test/plugin/loader-shared.test.ts test/plugin/trade-context-mode.test.ts`
- [ ] 失敗ケース（存在しない delegate）で起動継続確認

### Risk & Rollback

- Rollback: `OPENCODE_TRADE_CONTEXT_MODE=off` → `OPENCODE_PURE=1`
- 既知制約: context-mode 本体依存は未導入（PoC）

### Attachments

- `docs/opencode-trade-context-mode-review-checklist.md`
- テスト結果（pass summary）
- 完成版サンプル: `docs/opencode-trade-context-mode-pr-ready-example.md`

## PR本文（コピペ例）

```markdown
## Summary

- [ ] `.opencode/plugins/trade-context-mode.ts` を追加・更新し、`off / tools / shadow` のみを扱う。
- [ ] delegate import 失敗時の fail-open 化を確認。
- [ ] `ctx_` ツール監査（malformed tool の除外）を追加。

## Changes

- Add/Update: `.opencode/plugins/trade-context-mode.ts`
- Update: `packages/opencode/test/plugin/trade-context-mode.test.ts`
- Add fixture: `packages/opencode/test/fixture/trade-context-mode-delegate-invalid-tool-plugin.ts`
- Docs:
  - `docs/opencode-trade-context-mode-review-checklist.md`
  - `docs/opencode-trade-context-mode-pr-template.md`

## Verification

- [ ] `cd packages/opencode && bun test test/plugin/trade-context-mode.test.ts`
- [ ] `cd packages/opencode && bun test test/plugin/loader-shared.test.ts test/plugin/trade-context-mode.test.ts`
- [ ] rollback 検証（`OPENCODE_TRADE_CONTEXT_MODE=off`）

## Risk / Rollback

- 既知制約: context-mode 本体依存は未導入（PoC）
- Rollback 手順:
  - `OPENCODE_TRADE_CONTEXT_MODE=off`
  - 必要なら `OPENCODE_PURE=1`

## Notes

- on / strict は現時点 off 相当として扱い、delegate import しない。
```

## PR 提出前最終チェック（固定順）

- [ ] `docs/opencode-trade-context-mode-review-checklist.md` を同梱し、全項目を確認済みとして埋める
- [ ] `PR本文（コピペ例）` の `Verification` を完了し、チェックを残す
- [ ] ロールバック手順を明記する（`OPENCODE_TRADE_CONTEXT_MODE=off` / `OPENCODE_PURE=1`）
