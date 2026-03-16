## upstream sync

このリポジトリは `anomalyco/opencode` の fork ですが、追従対象は `upstream/dev` の常時最新ではなく、upstream が公開した version tag です。

履歴基点は `v1.2.26` です。`origin/dev` はこの tag から securecode 固有変更を積み、その後に `sync/upstream-v1.2.27` を merge した形へ改めています。以後の upstream intake は新しい tag が出たときだけ行います。

### branch roles

- `upstream/dev`
  - upstream の参照用 branch
  - 日常運用では読むだけ
  - 直接 merge 元にはしない
- `vendor/upstream-release`
  - upstream の最新 release tag を写す mirror branch
  - `dev` がまだ未採用の tag を指していてもよい
  - securecode 独自修正は入れない
- `dev`
  - securecode の正規開発 branch
  - securecode の変更と upstream sync を merge commit で残す
- `sync/upstream-v<version>`
  - 新しい upstream tag 差分を `dev` に取り込むための intake branch
  - 例: `sync/upstream-v1.2.28`
  - `origin/dev` の最新から切る
  - branch 上で upstream tag を直接 merge する
  - conflict 解消はこの branch 上で行う
- `feature/*`, `fix/*`, `chore/*`
  - 通常開発用 branch
  - 原則として `dev` から切って `dev` に戻す

### seed state

- history base tag: `v1.2.26`
- current adopted upstream tag on `dev`: `v1.2.27`
- seed mirror: `vendor/upstream-release`
- `origin/dev` は `v1.2.26` -> securecode commit 2 本 -> `Merge branch 'sync/upstream-v1.2.27' into dev`

### core rules

- `upstream/dev` を `dev` に直接 merge しない
- `upstream` に push しない
- `vendor/upstream-release` に手動修正を入れない
- upstream intake は新しい release tag が出たときだけ行う
- upstream intake は必ず `sync/upstream-v<version>` PR 経由にする
- securecode 独自修正は `dev` 側にのみ置く
- open 中の sync PR がある間は次の sync PR を増やさない
- `dev` への PR は merge commit で入れる

### why this works

- `dev` の基点が upstream の正式 version tag に固定される
- upstream の未リリース変更を誤って取り込まない
- securecode 固有差分が release 単位で整理される
- intake PR が tag 単位になるので、追従判断が明確になる
- sync branch 上で conflict 解消の有無を追いやすい

### normal development flow

securecode 固有の通常開発は以下です。

1. `dev` から作業 branch を切る
2. 変更を実装する
3. `origin` に push する
4. `dev` 向け PR を作る
5. review 後に通常の merge commit で `dev` へ入れる

このとき `vendor/upstream-release` や `sync/upstream-v*` は触りません。

### upstream intake flow

新しい upstream tag が出たときだけ以下を行います。

1. upstream tags を fetch する
2. `dev` が現在どの upstream tag まで採用済みか判定する
3. 新しければ `vendor/upstream-release` をその tag に更新する
4. `dev` から `sync/upstream-v<version>` を切る
5. sync branch 上で target tag を merge する
6. conflict があれば sync branch 上で解消する
7. 必要なら conflict 解消 commit を追加する
8. `dev` 向け PR を作る
9. review 後に通常の merge commit で `dev` へ入れる

### conflict policy

- conflict 解消は `dev` ではなく `sync/upstream-v*` 上で行う
- 解消方針は「upstream の新仕様を尊重しつつ securecode 要件を残す」
- ロゴ、ブランド、securecode 固有 route は securecode 側を維持する
- API、型、基盤実装は可能な限り upstream tag 側へ合わせる
- conflict が発生した場合は sync branch 上に明示的な解消 commit を残してよい

### automation

- `bun run guard:upstream`
  - `remote.pushDefault=origin`
  - `branch.dev.remote=origin`
  - `branch.dev.merge=refs/heads/dev`
  - `remote.upstream.fetch` を `dev` のみに制限
  - `remote.upstream.prune=true` を設定
  - `upstream` の push URL を `no_push` に固定
  - 既存の不要な `upstream/*` remote-tracking refs を掃除する
  - `gh` があれば default repo を `origin` に寄せる
- `.husky/pre-push`
  - `upstream` 名義と `anomalyco/opencode` URL への push を拒否
  - その後で Bun バージョン確認と typecheck を実行
- `.github/workflows/upstream-sync.yml`
  - `repository_dispatch` と `workflow_dispatch` に対応
  - 15 分おきに upstream tags を確認する
  - 新 tag が出たときだけ `vendor/upstream-release` を更新する
  - 必要なら `sync/upstream-v<version>` を `origin/dev` から作る
  - sync branch 上で target tag を merge し、`dev` 向け PR を作る

GitHub Actions 単体では他 repository の tag push を event として直接受けられないため、実際の自動化は「頻繁な tag ポーリング + 新 tag のときだけ動作」です。

### merge policy

- GitHub の branch protection では merge commit を許可する
- `dev` では rebase merge / squash merge を使わない
- feature PR も sync PR も通常の merge commit に統一する
- upstream の完全な tag 実体は `vendor/upstream-release` に残す

### local commands

- `bun run guard:upstream`
  - ローカル Git 設定を安全側に寄せる
- `bun run mirror:upstream`
  - `vendor/upstream-release` を現在採用すべき upstream tag に合わせる
- `bun run plan:upstream`
  - 次に作るべき sync branch 名と target tag を表示する
- `bun run sync:upstream`
  - `sync/upstream-v<version>` を作って push する

### local runbook

1. `bun install`
2. `bun run guard:upstream`
3. `bun run mirror:upstream`
4. `bun run plan:upstream`
5. `bun run sync:upstream`
6. 必要なら sync branch 上で conflict を解消する
7. `dev` に merge する

### do and do not

- やってよいこと
  - `dev` から通常開発 branch を切る
  - `vendor/upstream-release` を tag mirror として force update する
  - `sync/upstream-v*` で conflict を解消し、解消 commit を残す
- やってはいけないこと
  - `upstream` に PR や push を送る
  - `dev` に対して `upstream/dev` を直接 merge する
  - `vendor/upstream-release` に securecode 独自修正を直接 commit する
  - release tag と関係ない timing で sync PR を乱立させる

### current examples

- history base tag: `v1.2.26`
- current adopted upstream tag: `v1.2.27`
- mirror branch: `vendor/upstream-release`
- sync branch example: `sync/upstream-v1.2.28`

sync branch 名には upstream version tag をそのまま含めます。
