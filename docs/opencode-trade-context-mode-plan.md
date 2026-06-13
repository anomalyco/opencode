# opencode-trade Context Mode 導入案

## 目的

`context-mode` を `opencode-trade` 専用の **限定 PoC** として導入し、巨大ログや調査出力のコンテキスト圧迫を減らす。

`trade-memory` の authoritative な役割は維持し、`context-mode` は raw output の sandbox / temporary index に限定する。

## 方針

- 直接 `context-mode` を `opencode.jsonc` に入れず、`.opencode/plugins/trade-context-mode.ts` でラップする
- デフォルトは `off` にする
- `trade-memory` は残す
- `context-mode` は raw output の sandbox / temporary index 用に限定する
- `mcp.context-mode` は使わない
- upstream の routing file はそのまま上書きしない
- 初期導入は `off` / `tools` / `shadow` のみとし、`on` / `strict` は後続 phase に送る
- wrapper 例外は fail-open とし、OpenCode 本体と `trade-memory` を壊さない
- wrapper は top-level import で `context-mode` を読まない
- `OPENCODE_PURE=1` を最終 rollback 手段として明記する

## 実装前監査の結論

- `off` は runtime 停止であり、loader 障害の完全な保険ではない
- `trade-memory` との主衝突点は tool 名ではなく、記憶の権威と hook 注入である
- `context-mode` は強い実行系 tool を持ち得るため、権限境界の確認なしに全面導入してはいけない
- 最初の実装単位は `context-mode` 依存追加ではなく、無害な wrapper skeleton と spike にする

## 想定効果

| 領域 | 期待効果 |
| --- | --- |
| 長いログ | MT5 log, CI log, grep 結果の圧縮 |
| compaction | 再開時の文脈復元を補助 |
| 調査 | script 化された検索・集計でノイズ削減 |
| handoff | `trade-memory` と別経路で補助的検索が可能 |

## 想定リスク

| 領域 | リスク |
| --- | --- |
| 記憶の重複 | `trade-memory` と `context-mode` の両方に履歴が残る |
| prompt 重複 | system transform が二重注入される |
| hook 遅延 | tool 実行ごとの I/O が増える |
| 作業阻害 | block/redirect が MT5 系作業を止める可能性 |
| 障害範囲 | plugin 起動失敗が OpenCode 起動に波及する可能性 |
| secret 保存 | MT5 logs、broker profile、token-like text を一時 index に入れる可能性 |
| rollback | wrapper 破損時に `off` だけでは救えない可能性 |

## `trade-memory` との分担

| 役割 | 担当 |
| --- | --- |
| 作業中の会話履歴 | `trade-memory` |
| 意思決定・risk・handoff | `trade-memory` |
| compaction 用の補助 context | `context-mode` |
| 大きな tool output の sandbox | `context-mode` |
| 監査証跡 | `SPRINT.md` / `REVIEW_NOTES.md` / `backtest/results/*.json` |

## wrapper plugin 案

- ファイル: `.opencode/plugins/trade-context-mode.ts`
- 役割: `context-mode` を遅延読み込みし、mode に応じて hook を絞る
- 実装方針: `OPENCODE_TRADE_CONTEXT_MODE` で制御する
- 初回 PR は inert skeleton のみで、実物 `context-mode` の import は後追いにする

### 事前 spike

- `context-mode` の OpenCode plugin export shape を確認する
- import / plugin factory 呼び出しで副作用がないか確認する
- `ctx_*` tool 名と実際の登録結果を確認する
- storage path と purge 手順を確認する
- delegated hook 例外を wrapper で握れるか確認する
- `tools` / `shadow` で `trade-memory` 非干渉を確認してから依存追加する

### mode

| mode | 挙動 |
| --- | --- |
| `off` | 無効 |
| `tools` | `ctx_*` tools のみ有効 |
| `shadow` | 記録中心。block はしない |
| `on` | 後続 phase でのみ検討 |
| `strict` | 後続 phase でのみ検討 |

### 初回実装範囲

- `off` / `tools` / `shadow` のみ実装する
- `on` / `strict` はコードにも routing にも入れない
- `system.transform` と `session.compacting` は初期では無効のままにする
- `tool.execute.before` は初期では返さない
- `tool.execute.after` も初期は記録のためだけに限定する

## 初期導入順

1. `tools` mode を試す
2. `shadow` mode で記録系 hook を確認する
3. `on` / `strict` は実装しないまま保留する

## 実行手順（PoC）

- 無効化（既定）
  - `OPENCODE_TRADE_CONTEXT_MODE=off`
  - もしくは変数を未設定

- ツール露出のみ
  - `OPENCODE_TRADE_CONTEXT_MODE=tools`
  - `OPENCODE_TRADE_CONTEXT_MODE_DELEGATE` に読み込む plugin パスを指定
  - 指定候補の delegate 側で `ctx_*` プレフィックスの tool のみが `tool` hook として露出

- 記録 hook（Fail-open）
  - `OPENCODE_TRADE_CONTEXT_MODE=shadow`
  - `tool.execute.after` を delegate から引き継ぎ、delegate 例外は握りつぶし

- rollback
  - `OPENCODE_TRADE_CONTEXT_MODE=off`
  - それでも問題が残る場合は `OPENCODE_PURE=1`

## 命名ガイドライン（PoC）

- context-mode の tool は原則 `ctx_` で始める。
- 推奨フォーマットは `ctx_<domain>_<action>`（例: `ctx_search`, `ctx_stats`, `ctx_audit_recent`）。
- 非 `ctx_` の tool は公開されないため、PoC 外にある有効な機能でも露出されない。
- 依存追加時は名前規則の見直しを必須とし、`ctx_` プレフィックスがないものは `tools` mode で検証しても使えないことを前提に扱う。

## 運用チェック（軽量）

- `off` → 起動時既定。`OPENCODE_TRADE_CONTEXT_MODE` を未設定でも同等扱い。
- `tools` → `OPENCODE_TRADE_CONTEXT_MODE=tools` と `OPENCODE_TRADE_CONTEXT_MODE_DELEGATE=<path>` で有効化。
- `shadow` → `tool.execute.after` の fail-open 挙動を目視。
- 異常時 → `OPENCODE_TRADE_CONTEXT_MODE=off`、それでも悪化する場合は `OPENCODE_PURE=1`。

## 実行テンプレート

```sh
export OPENCODE_TRADE_CONTEXT_MODE=tools
export OPENCODE_TRADE_CONTEXT_MODE_DELEGATE="./.opencode/plugins/my-context-mode.ts"
```

```sh
export OPENCODE_TRADE_CONTEXT_MODE=shadow
export OPENCODE_TRADE_CONTEXT_MODE_DELEGATE="./.opencode/plugins/my-context-mode.ts"
```

```sh
export OPENCODE_TRADE_CONTEXT_MODE=off
```

- `off` は最短の停止切替。必要なら続けて `export OPENCODE_PURE=1` で最終隔離。

## 設定の現時点

- plugin 本体: `.opencode/plugins/trade-context-mode.ts`
- 実体の依存追加: 未実施（PoC スケルトン + spike）
- `OPENCODE_TRADE_CONTEXT_MODE_DELEGATE` 未設定時は delegate なしとして扱い、`tools` / `shadow` はいずれも無害フォールバック

## 段階導入

### Phase 0

- 方針固定
- mode 名と default を決める

### Phase 1

- wrapper skeleton を追加
- `ctx_*` tools のみ共存確認
- `trade-memory` 非干渉を確認
- `off/tools/shadow` の fail-open 挙動を確認する
- ここでは `context-mode` 依存をまだ追加しない

### Phase 2

- `ctx doctor` / `ctx stats` の確認手順を整備する
- fallback と rollback を明確化する
- export shape / init side effect / storage path の spike 結果を反映する
- 依存追加は spike 合格後に限定する

### Phase 3

- `tool.execute.after` などの記録系 hook を段階的に開く
- system transform は最小注入に抑える
- `tool.execute.before` はまだ開かない

### Phase 4

- routing を `opencode-trade` 用に短く調整する
- upstream の汎用 routing はそのまま持ち込まない
- `trade-memory` を authoritative とする前提を routing でも明記する

### Phase 5

- 必要なら `on` / `strict` を限定的に試す
- MT5 / CI / web fetch の阻害がないか確認する

## 実装の要点

- dynamic import で壊れた依存に引きずられないようにする
- 既存 config は壊さず、環境変数で on/off する
- OpenCode restart 前提にする
- 既存の `trade-handoff-bridge` と `system.transform` / `session.compacting` が衝突しないようにする
- delegated hook はすべて fail-open にする
- `context-mode` の version を pin する
- wrapper 例外は `context-mode` 失敗として握りつぶし、OpenCode 本体には波及させない

## 既知の確認項目

- `sync_trade_memory` が引き続き使えること
- `ctx_*` と trade-memory tools が共存すること
- system prompt が過剰に長くならないこと
- compaction 後に古い snapshot が優先されないこと
- `OPENCODE_TRADE_CONTEXT_MODE=off` で即戻せること
- `OPENCODE_PURE=1` で最終退避できること

## Storage / Secret Policy

- context-mode の保存場所を固定する
- purge 手順を用意する
- broker account、token-like output、local path を一時 index に入れる可能性を明示する
- MT5 risk gate、live readiness、Class D 判断には `ctx_search` 結果だけを使わない
- 初回 PoC では secret-like output を含む tool に `context-mode` を使わない

## Go / No-Go

### Go

- wrapper skeleton が `off` で無害に起動する
- `tools` / `shadow` の hook filter test が通る
- hook 例外が fail-open で止まらない
- storage / purge / export shape の spike が取れる

### No-Go

- import 時点で heavy side effect がある
- `off` でも dynamic import が走る
- `trade-memory` と snapshot 優先順位を決められない
- `ctx_execute` の権限境界を説明できない
- `OPENCODE_PURE=1` 以外の rollback がない

## Test / Smoke

- `off` で `{}` のみ返ること
- `tools` で tools のみ返ること
- `shadow` で `tool.execute.before` を返さないこと
- delegated hook throw が呼び出し元へ伝播しないこと
- `sync_trade_memory` 系 tool が消えないこと
- MT5 workflow が block されないこと
- `on` / `strict` が未実装でも既存 workflow が壊れないこと

### `on` / `strict` の未実装保険テスト

- `on` / `strict` は現状 off と同等として扱う。
- これらの値を指定しても delegate import は起きないこと。
- これらの値を指定しても `{}` のみを返し、既存の hook 追加が起きないこと。

## 期待結果付き運用チェックリスト

- `off` をセットして起動する
  - 期待: `plugin` 初期化は `{}` のみ、警告ログが出ない

- `tools` で有効化し、delegate を `ctx_*` 対応実装へ設定する
  - 期待: `ctx_*` tool だけが見える。`tool.execute.before/after` や `system.transform` は出ない

- `tools` で delegate を存在しないパスに設定する
  - 期待: 起動継続、`{}` にフォールバック、警告ログ 1 回以上

- `shadow` で delegate を存在しないパスに設定する
  - 期待: `tool.execute.after` の noop hook を保持、警告ログ 1 回以上

- `on` / `strict` を指定する
  - 期待: `off` と同等で `{}` のみ、delegate import は起きない

## PoC 完了チェック（レビュー向け）

- `off` / 未設定 / 空白文字の mode
  - `plugin` が `{}` を返す
  - 未実装モード指定 (`on`, `strict`) としても import が走らない
- `tools`
  - `ctx_` で始まる tool のみが残る
  - `tool.execute.after` / `tool.execute.before` / `experimental.*` は露出しない
  - `ctx_` 名前でも tool 定義が不正な場合は除外される
  - relative/absolute delegate パスが解決できる
- `shadow`
  - `tool.execute.after` を fail-open で委譲
  - 委譲 hook が非関数でも noop で安全に復帰
  - 委譲失敗時は起動継続（警告出力あり）
- rollback
  - `off` で delegate が未参照
  - `off`→`OPENCODE_PURE=1` で最終隔離まで確認

レビュー提出時は、`docs/opencode-trade-context-mode-review-checklist.md` を添付して 1 画面チェックを行う。

## PR 提出テンプレ

- PR テンプレ用: `docs/opencode-trade-context-mode-pr-template.md`
- 本チェックリスト → テスト結果 → 想定リスクの順で添付する
- PR 本文のコピペ例は同テンプレート内の `PR本文（コピペ例）` を使用
- 完成版サンプル本文は `docs/opencode-trade-context-mode-pr-ready-example.md`
- PR 提出前最終チェック（固定順）:
  - チェックリストを添付し、全項目を確認済みとして埋める
  - PR本文コピペ例を埋め、Verification を完了する
  - Rollback 記載を残す（`OPENCODE_TRADE_CONTEXT_MODE=off` / `OPENCODE_PURE=1`）

### 関連テスト

- `trade-context-mode plugin > on` / `strict` 系の未実装ガード
- `trade-context-mode plugin > non-function tool.execute.after` 系のフォールト耐性
- `trade-context-mode plugin > malformed ctx_ tool` 系のハードニング
- `trade-context-mode plugin > invalid delegate path` 系の fail-open 系

## 快速スモーク手順

- 1 行コマンド:

```sh
cd packages/opencode
OPENCODE_TRADE_CONTEXT_MODE=tools OPENCODE_TRADE_CONTEXT_MODE_DELEGATE=./test/fixture/trade-context-mode-delegate-plugin.ts bun test test/plugin/trade-context-mode.test.ts
```

- 期待結果:
  - `tools mode` 系のテストが通る（`ctx_search` のみが tool として検出される）
  - delegate が不在なら同一テスト内の fallback 経路が成立し、失敗テストとして `{} にフォールバック` が観測される

- 2 行目（rollback）:

```sh
cd packages/opencode
OPENCODE_TRADE_CONTEXT_MODE=off bun test test/plugin/trade-context-mode.test.ts
```

- 期待結果:
  - `off` で delegate import に触れず `{}` のみ

## まず避けること

- `plugin: ["context-mode"]` を直書きすること
- MCP と plugin を同時に入れること
- upstream の routing file をそのままコピーすること
- 最初から `strict` を有効にすること
- `trade-memory` を置き換えること
- `ctx_search` だけで最終判断すること

## 期待する運用像

`trade-memory` が project の正式な記録系、`context-mode` が一時的な大出力の圧縮系、という二層構成にする。

この形なら、試用時は `on/off` で切り替えられ、問題があれば `off` に戻して即座に従来運用へ復帰できる。

## 監査後の結論

- 本実装ではなく、限定 PoC として進める
- 初期は `tools` / `shadow` のみ
- `on` / `strict` は spike と test 完了後に判断する
- まずは wrapper skeleton を実装し、context-mode 本体の依存追加はその後に行う
