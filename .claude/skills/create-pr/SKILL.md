---
name: create-pr
description: securecode リポジトリで GitHub Pull Request を新規作成するときの手順。`gh pr create` を実行する前に必ず読む。同一リポ重複チェック、upstream 重複チェック、リポ指定 (-R)、upstream-policy / 実装場所の選定、PR テンプレート、securecode-manual の更新確認、live PR の verify、コメント追記ルール (編集禁止) を網羅する。`.opencode/skills/gh-pr-compliance/SKILL.md` を併せて参照する。
---

# create-pr

`acompany-develop/securecode` で PR を新規作成するときの手順。

このスキルは「PR を作る前後のフロー全体」を扱う。PR タイトル / 本文の規約遵守チェックの細部は別 skill (`.opencode/skills/gh-pr-compliance/SKILL.md`) が担当しているので、両方読むこと。

## 趣旨 (必ず守る)

- 必ず `-R acompany-develop/securecode` を明示する。省略すると upstream 側に PR が作られる事故が起きる (過去複数回発生)。
- まず securecode 側、次に upstream 側で同じテーマの issue / PR が既に存在しないか確認する。**順序を間違えない**: 同一リポ内重複の解消が最優先。
- 開発作業は **必ず git worktree で行う**。メインの作業ディレクトリ (`/Users/sotasakamoto/Develop/securecode`) では絶対にファイルを変更しない (`CLAUDE.local.md` 参照)。
- 実装場所は `CLAUDE.md` の upstream-policy に従う。**upstream owned のソースは原則として触らない**。詳細は [3. 実装場所の判定](#3-実装場所の判定-upstream-policy) を厳密に守ること。
- PR 作成前に `packages/opencode/src/securecode/skills/securecode-manual/*.md` の更新要否を確認し、PR 本文に明記する。
- 一度作った PR の本文・タイトル・コメントを **編集しない**。訂正は新規コメントで追記し、過去の記述には取り消し線を引く ([[コメント追記ルール](#10-コメント追記ルール)] 参照)。

## 手順

### 1. securecode 側の重複チェック (最優先)

まず最優先で、このリポに同じテーマの PR / issue が既に立っていないか確認する。同一リポでの重複が最も致命的。

```bash
gh issue list -R acompany-develop/securecode --search "<keyword>" --state all
gh pr list -R acompany-develop/securecode --search "<keyword>" --state all
```

キーワードは機能名 / エラーメッセージ / 関連ファイル名など複数の角度で試す。1 回の検索で「ない」と決めない。

該当があれば:

- まだ open な PR があれば、新規ではなく既存 PR を更新する
- 議論が既に進んでいる issue があれば、そちらにコメントしてから着手する
- closed でも関連が強いなら、新規 PR 本文から既存 PR / issue へのリンクを必ず張る

### 2. upstream 重複チェック

次に upstream (`anomalyco/opencode`) で同じテーマが進行中でないか確認する。

```bash
gh issue list -R anomalyco/opencode --search "<keyword>" --state all
gh pr list -R anomalyco/opencode --search "<keyword>" --state all
```

該当があれば、ユーザーに報告して「securecode 側で別途進める / upstream に出す / upstream を待つ」のどれを取るか判断を仰ぐ。勝手に進めない。

### 3. 実装場所の判定 (upstream-policy)

これは `CLAUDE.md` の upstream-policy の **再掲ではなく念押し**。upstream owned のソースを触る PR は、後の upstream sync で衝突するため追従コストが恒久的に上がる。だから plugin / securecode 固有で済むなら、絶対にそちらを選ぶ。

判定は以下の順で厳密に行う。**段階を飛ばさない**。

#### Step 1: opencode plugin 機構で実装できるか

**ここで「できる」と結論できるなら、何があってもこの段階で実装する**。

- **server-side hook** で達成できないか:
  - `tool.execute.before` / `tool.execute.after` / `chat.params` / `chat.headers` / `experimental.chat.messages.transform` / `experimental.chat.system.transform` / `command.execute.before` / `permission.ask` / `tool.definition` / `shell.env` 等
  - できるなら `packages/opencode/src/securecode/plugins/` 配下に plugin として書き、`packages/opencode/src/plugin/index.ts` の `INTERNAL_PLUGINS` 配列に 1 行追加する
- **TUI plugin** で達成できないか:
  - slot 差し替え (`home_logo` / `sidebar_footer` / `home_footer` 等)、独自 command 登録、keybind 追加 等
  - できるなら `packages/opencode/src/securecode/tui-plugins/` 配下に plugin として書き、`packages/opencode/src/cli/cmd/tui/plugin/internal.ts` の `INTERNAL_TUI_PLUGINS` 配列に 1 行追加する

#### Step 2: securecode 固有ファイルで済むか

plugin 化できなかった場合のみ次に検討。以下の **securecode 固有ファイル** の追加 / 変更で済むかを確認する:

- `packages/opencode/src/securecode/**`
- `packages/opencode/test/securecode/**`
- `setup/**`
- `install-securecode`
- `script/release-securecode.ts`
- `specs/**`
- `.opencode/**`
- `.claude/**`
- `benchmarks/securecode/**`

これらの追加 / 変更で完結するなら、必ずこちらを選ぶ。

#### Step 3: upstream owned のソースに触る (原則として避ける)

それでも **upstream owned のソース** に触らなければ実現できないと結論した場合のみ、最終手段として検討する。対象:

- `packages/opencode/**` (`securecode/` 配下を除く)
- `packages/core/**`
- `packages/plugin/**`
- `packages/app/**`
- `packages/sdk/**`
- `packages/tui/**`
- `packages/desktop/**`

このパスを取るときの判断基準:

1. 機能の価値と継続的な追従コストを天秤にかけ、価値が明確に上回るか
2. 純粋な UX 改善で plugin 化が構造的に不可能なケースは **原則として見送る**
3. 代替手段 (手順書追記 / 既存 env var による opt-out / docs 追加) で代用できないかを最後にもう一度検討する

upstream owned に触る PR を出す場合は、PR 本文に必ず以下を明記する:

- なぜ Step 1 (plugin 化) が構造的に不可能なのか
- なぜ Step 2 (securecode 固有ファイル) で済まないのか
- この変更を取り込むことで発生する upstream 追従コストの見積もり

詳細・過去の判断例は `specs/upstream-policy.md` を参照。

### 4. worktree で作業 (CLAUDE.local.md ルール)

メインディレクトリでは絶対にファイルを変更しない。worktree を作って作業する。

```bash
# 1. メインで dev を最新化
cd /Users/sotasakamoto/Develop/securecode
git fetch origin && git checkout dev && git pull --ff-only origin dev

# 2. 最新の dev から worktree を派生
git worktree add /Users/sotasakamoto/Develop/securecode/.claude/worktrees/<branch-name> -b <branch-name> dev
```

ブランチ名は `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>` のように conventional な prefix を付ける。

### 5. gh-pr-compliance skill を読む

PR 規約遵守の詳細チェックは `.opencode/skills/gh-pr-compliance/SKILL.md` が担当。create-pr の中から必ずそちらも参照すること。重複説明はしないので、以下の点をそちらで確認する:

- PR タイトル規約 (conventional prefix)
- `.github/pull_request_template.md` の section
- linked issue の必須性
- live PR の verify 手順

### 6. PR テンプレートを埋める

`.github/pull_request_template.md` の section を **削除せず**、すべて埋める。該当なしの section は「該当なし」と明記する。

securecode の PR template の主要 section:

- `### このPRに関連するIssue` → `Closes #<番号>` または `Refs #<番号>`
- `### 編集した内容` → 該当する種別の checkbox を `[x]` にする (バグ修正 / 新機能実装 / リファクタ / ドキュメント)
- `### このPRでしていること` → 何を変えたか、なぜそれで直るかの説明 (推測ではなく検証済みの理由)
- `### 検証方法` → 自分が動かしてみた手順、テスト結果
- `### スクリーンショット / 録画` → UI 変更時は必須。テキストのみの変更なら「該当なし」
- `### チェックリスト` → ローカルテスト済みか、関係ない変更を含んでいないかを正直に申告

> _このテンプレートに従わない場合、PR は自動的にRejectされます_ ← 自動 reject の対象になる。section の見出しを変えたり削ったりしない。

### 7. securecode-manual の更新確認 (CLAUDE.md ルール)

PR を作成する前に、`packages/opencode/src/securecode/skills/securecode-manual/*.md` の以下の章を grep して、変更内容と矛盾していないか確認する。

- `00-overview.md`
- `01-installation.md`
- `02-quickstart.md`
- `03-commands.md`
- `04-config.md`
- `05-sandbox.md`
- `06-troubleshooting.md`
- `07-faq.md`

PR 本文に **必ず** 以下のどちらかを明記する:

- `manual updated: <章名>` — 該当章を更新した
- `manual: no change needed (reason: <理由>)` — 該当しない理由

「マニュアル更新を忘れる」と built-in skill としてバイナリに焼かれたままになり、ユーザーへ古い情報を案内し続ける事故になる。

### 8. PR 作成コマンド

```bash
# まずブランチを remote に push
git push -u origin <branch-name>

# PR 作成
gh pr create \
  -R acompany-develop/securecode \
  --base dev \
  --head <branch-name> \
  --title "<conventional prefix>: <title>" \
  --body-file <(cat <<'EOF'
### このPRに関連するIssue

Closes #<番号>

### 編集した内容

- [x] バグ修正
- [ ] 新機能実装
- [ ] リファクタ / コード改善
- [ ] ドキュメント作成

### このPRでしていること

<具体的な変更内容と理由>

### 検証方法

<手元で確認した手順>

### スクリーンショット / 録画

該当なし

### チェックリスト

- [x] 変更をローカルでテストしました
- [x] 関係ない変更は含めていません

### マージ方法

- 既定: `Squash and merge` を使用

### マニュアル更新

manual updated: <章名>
または
manual: no change needed (reason: <理由>)
EOF
)
```

注意点:

- `-R acompany-develop/securecode` は **必須**。
- `--base dev` を明示する。default branch は `dev`。
- body は `--body-file` でヒアドキュメント経由を推奨。
- title の prefix は `feat:` / `fix:` / `chore:` / `docs:` / `refactor:` 等の conventional 形式。

### 9. live PR を verify

PR 作成後、必ず実物を確認する。

```bash
gh pr view <番号> -R acompany-develop/securecode --json title,body,baseRefName,headRefName,labels,url
gh pr checks <番号> -R acompany-develop/securecode
```

確認項目:

- タイトルが規約に沿っているか
- linked issue が解決されているか (`Closes #` の番号が正しいか)
- template section が全部残っているか
- base が `dev`、head が自分のブランチか
- bot のコメントが早めに来た場合、規約違反を指摘していないか
- CI checks が走っているか / 失敗していないか

bot が compliance 違反を指摘してきたら、**コメントを編集せず**、`gh pr edit` で title / body の該当部分を直し、新規コメントで「指摘 X を反映しました」と追記する。

### 10. コメント追記ルール

PR コメントを **編集してはいけない**。理由:

- 編集するとレビュアーから編集履歴が見えづらく、議論の経緯が追えなくなる
- どの判断が最新で、なぜ変わったのかが分かりにくくなる

訂正・追記・撤回が必要なときの手順:

1. 古いコメントの該当箇所に **取り消し線** を引く (`~~取り消したい文~~`)。取り消し線を引く目的に限って、その編集だけは許可する。
2. 新規コメントで「先ほどの〇〇は誤りでした。正しくは△△です」と追記する。

`gh pr comment <番号> -R acompany-develop/securecode --body "..."` で新規コメントを追加する。コメント本文の差し替え (gh の `--edit-last` や Web UI での編集) はしない。

例外: PR 本文を `gh pr edit` で更新する正規のフロー (compliance 違反の修正、`Closes #` の追加、checkbox の確定等) はこのルールの対象外。これは「PR 本文の section を埋める」運用上必要な操作。コメント (`gh pr comment`) は別。

## チェックリスト

- [ ] **まず securecode 側で同じテーマの issue / PR を探した** (最優先)
- [ ] 次に upstream 側で同じテーマの issue / PR を探した
- [ ] 該当があればユーザーに報告し、判断を仰いだ
- [ ] **実装場所を upstream-policy に従って選んだ**: Step 1 (plugin) → Step 2 (securecode 固有) → Step 3 (upstream owned, 最終手段) の順で検討した
- [ ] upstream owned に触る場合は、なぜ plugin / securecode 固有で実現できないかを PR 本文に明記した
- [ ] worktree を作成してそこで作業した (メインリポを汚していない)
- [ ] `.opencode/skills/gh-pr-compliance/SKILL.md` を読んだ
- [ ] PR テンプレートの section を全部埋めた (該当なしは明記)
- [ ] `securecode-manual` の該当章を grep し、PR 本文に `manual updated` / `manual: no change needed` を明記した
- [ ] `-R acompany-develop/securecode` と `--base dev` を付けた
- [ ] 作成後に `gh pr view` / `gh pr checks` で内容と CI を確認した
- [ ] bot のコメントで規約違反指摘がないか確認した
