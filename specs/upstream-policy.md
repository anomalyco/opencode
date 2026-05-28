## upstream divergence policy

このドキュメントは、securecode 側で機能追加 / 修正を行うときに、`packages/opencode/**` 等の upstream owned ファイルをどこまで触ってよいかを決めるための判断基準をまとめたものです。upstream 取り込みの mechanical な手順（branch / tag / conflict 解消 / automation）は別ドキュメント [`specs/upstream-sync.md`](./upstream-sync.md) を参照してください。

### 基本方針

securecode は `anomalyco/opencode` の fork として運用しており、追従コストの最小化を最優先で設計判断を行います。

1. **plugin で代替できる変更は plugin として実装する。** opencode のソース（`packages/opencode/**`, `packages/core/**`, `packages/plugin/**` 等の upstream owned ツリー）には原則として手を入れない。
2. **upstream の release tag は基本的に全追従する。** 中長期で取捨選択する可能性は残すが、現時点では「最新 release tag をそのまま取り込む」をデフォルトにする。tag 単位の追従手順は `specs/upstream-sync.md` を参照。
3. **本ポリシーは `CLAUDE.md` / `AGENTS.md` / `README.md` などの rules に reference を残す。** 個別実装の都度判断ではなく、リポジトリの行動規範として扱う。

これらは [Notion: upstream の差分取り込み方法を決める](https://www.notion.so/acompany-ac/upstream-34f269d85586802d8323f0ea9fc04b9f) での合意内容を成文化したものです。

### scope

このポリシーが対象とするのは「securecode の機能要件をどこに実装するか」「opencode 側を触らざるを得ないときの取り扱い」です。次は対象外です。

- upstream sync の mechanical な実行手順 → [`specs/upstream-sync.md`](./upstream-sync.md)
- sandbox / supply chain など securecode 全体のアーキテクチャ → [`specs/architecture/`](./architecture/) 配下の ADR
- 個別 issue / PR の意思決定 → 各 issue / PR 本文

### upstream owned とみなすパス

「触らない」「やむを得ず触る」を判断するための定義です。

| 区分 | 例 | 扱い |
|---|---|---|
| upstream owned | `packages/opencode/**`, `packages/core/**`, `packages/plugin/**`, `packages/app/**`, `packages/sdk/**`, `packages/web/**`, `packages/tui/**`, `packages/desktop/**`, `packages/console/**`, `packages/extensions/**`, `packages/storybook/**`, `packages/ui/**`, `script/**`（securecode 固有 script を除く） | 原則として直接修正しない |
| securecode 固有 | `packages/opencode/src/securecode/**`, `script/release-securecode.ts`, `script/securecode-*.ts`, `script/securecode-*.json`, `setup/**`, `install-securecode`, `specs/**`, `benchmarks/securecode/**`, `.opencode/**`（securecode リポジトリ直下の plugin / agent / command 等） | 自由に追加 / 変更可 |
| 同居だが securecode 固有 | `packages/opencode/AGENTS.md` などの説明文書、`packages/opencode/test/securecode/**` のテスト | securecode 固有として扱う |

判断に迷ったら原則「upstream owned」とみなして touch しない選択肢を優先する。

### 実装判断のフロー

新規機能 / 修正を入れるとき、以下の順で検討する。

1. **既存の opencode plugin 機構で実装できるか。** opencode には用途別に 2 系統の plugin loader がある:
   - **server-side plugin** — `tool.execute.before` / `tool.execute.after` / `chat.params` / `chat.headers` / `experimental.chat.messages.transform` / `experimental.chat.system.transform` / `command.execute.before` / `permission.ask` / `tool.definition` / `shell.env` 等の `Hooks` 系 API。出来るなら `packages/opencode/src/securecode/plugins/` 配下に plugin として書き、`packages/opencode/src/plugin/index.ts` の `INTERNAL_PLUGINS` に 1 行追加する。
   - **TUI plugin** — slot 差し替え (`home_logo` / `sidebar_footer` / `home_footer` 等)、TUI 内 command / keybind 追加、theme 提供 など Solid component / runtime API 系 (`@opencode-ai/plugin/tui`)。出来るなら `packages/opencode/src/securecode/tui-plugins/` 配下に plugin として書き、`packages/opencode/src/cli/cmd/tui/plugin/internal.ts` の `INTERNAL_TUI_PLUGINS` に 1 行追加する。
2. **plugin 機構で到達できない領域でも、securecode 固有ファイル（`packages/opencode/src/securecode/**` 配下、`setup/`、`install-securecode`、`script/release-securecode.ts` 等）の追加で達成できないか。** 出来るなら upstream owned のコードを触らずに済む。
3. **どうしても upstream owned のソースに手を入れる必要がある場合は、以下のいずれかが満たされるか確認する。**
   - 該当変更が upstream にも有益で、upstream にも PR を出せる
   - 機能上の価値が大きく、upstream merge 時の conflict 解消コストを継続的に払う覚悟がある
   - 一時的な hotfix で、upstream に同等の修正が入り次第 revert する前提
   - 上記が満たされない / 価値が小さい場合は **実装を見送る**

4. **実装するか見送るかの判断は、ユーザーに見える価値 vs 追従コストで決める。** 純粋な UX 改善（warn メッセージのテキスト調整、エラー時の hint 等）は plugin で出来ない場合は基本的に見送る方向で評価する。

5. **見送る場合の代替手段を提示する。** 例: ユーザー手順書側の説明追記、別ディレクトリで起動するなどの回避策、既存環境変数による opt-out 等。

### 過去の判断例

実際の運用に基づく decision の例。新しい判断を行うときの reference として残す。

| PR / issue | 種類 | 結果 | 要点 |
|---|---|---|---|
| [#102](https://github.com/acompany-develop/securecode/pull/102) | feature | merged | 4 ファイル touch（`plugin/index.ts` への 1 行 import + 登録のみ）で本体は plugin。`tool.execute.after` / `chat.params` / `experimental.chat.messages.transform` hook で完結。core 変更は最小化したが避けられない 1 行。 |
| [PR #123](https://github.com/acompany-develop/securecode/pull/123) / [#82](https://github.com/acompany-develop/securecode/issues/82) | feature | merged | upstream owned ファイル変更ゼロ。`install-securecode`（新規）と `script/release-securecode.ts`（securecode 固有）の追加のみ。 |
| [PR #126](https://github.com/acompany-develop/securecode/pull/126) / [#125](https://github.com/acompany-develop/securecode/issues/125) | feature | merged | acompany-branding を `tui.json` 経由 opt-in から `INTERNAL_TUI_PLUGINS` 経由の強制ロードに切り替え。upstream への diff は `cli/cmd/tui/plugin/internal.ts` の import 1 行 + 配列 entry 1 行のみ。TUI 系 plugin の append 先（`INTERNAL_TUI_PLUGINS`）が server 系 (`INTERNAL_PLUGINS`) と並ぶ手段であることの先例。 |
| [#122](https://github.com/acompany-develop/securecode/pull/122) / [#81](https://github.com/acompany-develop/securecode/issues/81) | feature | closed | `--no-project-plugins` CLI フラグ + MODULE_NOT_FOUND hint の追加。実装上 plugin hook で到達できない領域（yargs option 宣言 + plugin loader の filter）で、upstream 4 ファイルを触る。本来の致命バグは upstream loader 改修で既解消、残るのは純粋な UX 改善であり追従コストに見合わず **見送り**。 |
| [#83](https://github.com/acompany-develop/securecode/issues/83) | feature | closed | `securecode auth status` 診断 subcommand + 401/502 エラーメッセージ装飾。subcommand 宣言と provider error path への手入れが必要で plugin 化不能。既存ユーザー手順書セクション 6 でカバーできるため **見送り**。 |

### 補助 rules

`packages/opencode/src/plugin/index.ts` の `INTERNAL_PLUGINS` 配列、`packages/opencode/src/cli/cmd/tui/plugin/internal.ts` の `INTERNAL_TUI_PLUGINS` 配列など、構造上 1 行追加が避けられない箇所はあります。次の点を守る限り許容します。

- 追加行が 1〜数行で、ロジックは別ファイル（securecode owned: `packages/opencode/src/securecode/plugins/` または `packages/opencode/src/securecode/tui-plugins/`）に切り出されている
- 配列の **末尾に append のみ** で、既存 entry の削除や挿入位置の変更は行わない（upstream merge 時の conflict 面積を最小化するため）
- upstream の同名配列 / 同構造への merge conflict が想定しやすい場所であり、解消 cost が低い
- 該当ファイルに securecode 固有 import / 登録が増えるたびに本ドキュメントの「過去の判断例」表を更新する

`upstream-sync.md` の conflict policy で「API、型、基盤実装は可能な限り upstream tag 側へ合わせる」「ロゴ、ブランド、securecode 固有 route は securecode 側を維持する」と整合する範囲で行動してください。

### 中長期で再検討する論点

以下は現時点では決め打ちせず、運用の中で見直す前提です。Notion 議事録 に開発時の議論履歴があります。

- 追従の review 基準（kernel level の操作を含む場合は別 review 等）
- 追従 delay の設定（サプライチェーンリスクと bug fix 即時取り込みのバランス）
- securecode 改善のうち upstream に PR を出すべきものの選別ルール
- upstream の release tag の取捨選択ルール（中長期で「全追従」をやめるならその基準）

これらを変更する必要が出てきたときは、本ドキュメントを update し、`CLAUDE.md` / `AGENTS.md` 等から参照されている内容と齟齬が出ないようにしてください。

### 関連リンク

- [`specs/upstream-sync.md`](./upstream-sync.md) — upstream sync の mechanical workflow
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — PR / レビュー方針全般
- [`AGENTS.md`](../AGENTS.md) — coding style guide
- [Notion: upstream の差分取り込み方法を決める](https://www.notion.so/acompany-ac/upstream-34f269d85586802d8323f0ea9fc04b9f) — 議論の母体
