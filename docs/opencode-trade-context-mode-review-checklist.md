# opencode-trade Context Mode PoC レビュー・チェックリスト

## 概要

`off` / `tools` / `shadow` の PoC 仕様と回帰ハードニングが満たされているかを、レビュー時に 1 画面で確認するためのチェックです。

## 事前条件

- 対象リポジトリ: `packages/opencode`
- テスト実行場所: `packages/opencode`
- 追加プラグイン: `.opencode/plugins/trade-context-mode.ts`
- fixture: `packages/opencode/test/fixture/*trade-context-mode*`

## 実行順（レビュー前）

1. `cd packages/opencode`
2. `bun test test/plugin/trade-context-mode.test.ts`
3. `bun test test/plugin/loader-shared.test.ts test/plugin/trade-context-mode.test.ts`

## 想定結果

- `trade-context-mode.test.ts`: `pass`
- `loader-shared.test.ts` と同時実行: `pass`
- 失敗テストなし

## 受け入れチェック

- `off`/未設定/空白: `plugin` が `{}` を返す
- 未実装モード (`on` / `strict`): delegate import が起きない
- `tools`
  - `ctx_` ツールのみ露出
  - `tool.execute.before` / `tool.execute.after` / `experimental.*` は非露出
  - relative/absolute delegate パスが解決される
  - `ctx_` だが形状が不正な tool は除外される
- `shadow`
  - `tool.execute.after` が fail-open で委譲（または noop）
  - 非関数 hook を delegate しても noop に寄せて継続
- delegate import 失敗
  - `tools`: 起動継続、`{}` フォールバック
  - `shadow`: 起動継続、`tool.execute.after` noop 残存
- rollback
  - `OPENCODE_TRADE_CONTEXT_MODE=off` で `off` 相当へ復帰

## 参考観点

- `trade-memory` の主要 flow（`sync_trade_memory` 系）に影響しないことを目視確認
- 本番投入前はこのチェックの 3 項目を添付
  - 実行ログ
  - 追加・更新ファイル
  - 期待値が変わったテストの説明

## 提出用アセット

- PR テンプレート: `docs/opencode-trade-context-mode-pr-template.md`
- このチェックリストを PR 説明文に貼付し、該当項目を確認済みとしてチェック
- PR 本文のコピペ例: `docs/opencode-trade-context-mode-pr-template.md` の `PR本文（コピペ例）`
- 完成版: `docs/opencode-trade-context-mode-pr-ready-example.md`

## PR提出前最終チェック（固定順）

- [ ] `docs/opencode-trade-context-mode-review-checklist.md` を同梱し、全項目を確認済みとして埋める
- [ ] `PR本文（コピペ例）` を同じく埋め、`Verification` の 3 つを完了する
- [ ] ロールバック手順を明記する（`OPENCODE_TRADE_CONTEXT_MODE=off` / `OPENCODE_PURE=1`）
