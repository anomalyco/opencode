- 基本言語は日本語。ユーザー向けの返答、作業メモ、追記ドキュメントは原則として日本語を使うこと。
- 並列に実行できる調査や検証は、可能な限り並列化すること。
- この repo のデフォルトブランチは `dev`。
- PR を触る前に `.opencode/skills/gh-pr-compliance/SKILL.md` を読むこと。
- **`gh` CLI を実行する際は必ず `-R acompany-develop/securecode` を明示すること**。本リポは upstream remote (`anomalyco/opencode`) も持っているため、リポを明示しないと issue / PR / label 操作が upstream 側に作成される事故が発生する (過去複数回発生)。`gh issue create` / `gh pr create` / `gh pr view` / `gh pr edit` / `gh pr checks` / `gh label list` / `gh api` 等、すべての gh コマンドで例外なく `-R acompany-develop/securecode` を付けること。
- **Issue / PR を新規に作成する前に、必ず upstream (`anomalyco/opencode`) 側で同じテーマの issue / PR が既に存在しないか確認すること**。upstream で既に議論・実装が進んでいる場合、securecode 側で独自に作ると無駄になったり、後で upstream sync 時に衝突する。確認は `gh issue list -R anomalyco/opencode --search "<keyword>"` / `gh pr list -R anomalyco/opencode --search "<keyword>" --state all` で行う。upstream に該当があれば、まずユーザーへ「upstream にこういう issue/PR がある」と報告し、securecode 側で別途作るか / upstream の動向を待つか判断を仰ぐこと。
- SecureCode benchmark を扱うときは、まず `benchmarks/securecode/README.md` を読むこと。
- 最終レポートを書くときは `benchmarks/securecode/REPORT_AUTHORING_TIPS.md` に従うこと。
- `運用・販売の示唆` は、明示的に求められない限りレポートへ入れない。
- シークレットはファイルへ書かず、環境変数か一時的なコマンド引数として扱うこと。
- `benchmarks/securecode` の成果物は自動コミットしない。必要ならユーザー確認後に進めること。
- securecode は `anomalyco/opencode` の fork。upstream 追従コストを下げるため、新規機能 / 修正は以下の順で実装場所を選ぶこと。詳細・過去判断例は [specs/upstream-policy.md](./specs/upstream-policy.md) を参照。
  1. 既存の opencode plugin 機構で実装できないか確認する。次の 2 系統がある:
     - **server-side hook** (`tool.execute.before` / `tool.execute.after` / `chat.params` / `chat.headers` / `experimental.chat.messages.transform` / `experimental.chat.system.transform` / `command.execute.before` / `permission.ask` / `tool.definition` / `shell.env` 等) — 出来るなら `packages/opencode/src/securecode/plugins/` 配下に plugin として書き、`packages/opencode/src/plugin/index.ts` の `INTERNAL_PLUGINS` 配列に 1 行追加する。
     - **TUI plugin** (slot 差し替え `home_logo` / `sidebar_footer` / `home_footer` 等、独自 command 登録、keybind 追加) — 出来るなら `packages/opencode/src/securecode/tui-plugins/` 配下に plugin として書き、`packages/opencode/src/cli/cmd/tui/plugin/internal.ts` の `INTERNAL_TUI_PLUGINS` 配列に 1 行追加する。
  2. securecode 固有ファイル (`packages/opencode/src/securecode/**`, `packages/opencode/test/securecode/**`, `setup/**`, `install-securecode`, `script/release-securecode.ts`, `specs/**`, `.opencode/**` 等) の追加 / 変更で済むか確認する。済むならそちらを採用する。
  3. それでも upstream owned のソース (`packages/opencode/**`, `packages/core/**`, `packages/plugin/**`, `packages/app/**`, `packages/sdk/**`, `packages/tui/**`, `packages/desktop/**` 等) を直接触る必要があるときは、機能の価値と継続的な追従コストを天秤にかける。純粋な UX 改善で plugin 化が構造的に不可能なケースは原則として見送る。代わりにユーザー手順書側の説明追記や既存 env var 経由の opt-out など、コードに触らない代替手段を提示する。
