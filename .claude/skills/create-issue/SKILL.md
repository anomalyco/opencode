---
name: create-issue
description: securecode リポジトリで GitHub issue を新規作成するときの正しい手順。`gh issue create` を実行する前に必ず読む。同一リポ重複チェック、upstream 重複チェック、リポ指定 (-R)、テンプレート選択、ラベル設定、コメント追記ルール (編集禁止) を網羅する。
---

# create-issue

`acompany-develop/securecode` で issue を新規作成するときの手順。upstream (`anomalyco/opencode`) の fork なので、リポ指定漏れや重複起票の事故を避けるためのチェックを最初にやる。

## 趣旨 (必ず守る)

- 必ず `-R acompany-develop/securecode` を明示する。省略すると upstream 側に issue が立ち、過去複数回発生している事故になる。
- 起票前にまず securecode 側で同じ issue が既に立っていないかを確認する。次に upstream 側でも同じテーマが議論済みでないかを確認する。**順序が重要**: 同じリポ内の重複が最優先で潰すべき。
- issue 本文は具体的かつ簡潔に。AI 生成のテンプレ文をそのまま貼らない。
- 一度作成した issue やコメントは **編集しない**。訂正は新規コメントで追記し、過去の記述は取り消し線 (`~~text~~`) で残す ([[コメント追記ルール](#5-コメント追記ルール)] 参照)。

## 手順

### 1. securecode 側の重複チェック (最優先)

まず最優先で、このリポ (`acompany-develop/securecode`) に同じテーマの issue / PR が既に立っていないかを確認する。同一リポでの重複は議論が分散して回らなくなるので、何よりも先に潰す。

```bash
gh issue list -R acompany-develop/securecode --search "<keyword>" --state all
gh pr list -R acompany-develop/securecode --search "<keyword>" --state all
```

キーワードは複数の角度で試す (機能名 / エラーメッセージの一部 / 関連ファイル名 / 過去の似た言い回し)。1 回の検索で「ない」と結論しない。

該当があれば:

- まだ open なら、新規起票ではなくそちらにコメントで追記する
- closed でも関連が強いなら、新規 issue 本文から既存 issue へのリンクを必ず張る
- 同じ内容を別の言葉で立て直そうとしている可能性があれば、ユーザーに確認する

### 2. upstream 重複チェック

securecode 側に重複がないことを確認したら、次に upstream (`anomalyco/opencode`) に同じテーマが既に存在しないかを調べる。

```bash
gh issue list -R anomalyco/opencode --search "<keyword>" --state all
gh pr list -R anomalyco/opencode --search "<keyword>" --state all
```

該当があれば、ユーザーに「upstream にこういう issue/PR がある」と報告し、以下のどれを取るか判断を仰ぐ:

- securecode 側で別途起票する (理由を明記する)
- upstream の動向を待つ
- upstream の issue にコメント / PR を出す

ユーザーの判断なしに勝手に securecode 側へ起票しない。

### 3. issue テンプレートの確認

`.github/ISSUE_TEMPLATE/` を読み、該当するテンプレートを選ぶ。

```bash
ls .github/ISSUE_TEMPLATE/
```

securecode の主なテンプレート:

- `bug-report.yml` — バグ報告
- `feature-request.yml` — 新機能リクエスト
- `question.yml` — 質問

テンプレートの必須項目 (`required: true` の field) は全部埋める。任意項目もコンテキストがあるなら埋める。

### 4. 本文の書き方

- 言語: **日本語**
- 構成: 何が問題か → 再現手順 / 期待動作 → 関連リンク (PR, 過去 issue, upstream issue)
- AI 生成のテンプレ文 (「これは...の問題です」みたいな当たり前の前置き) を貼らない
- 推測ではなく、検証済みの事実を書く。未検証は「未検証」と明記する

### 4-1. 解決策・修正方針を書くときの upstream-policy 念押し

issue 本文で「こう直せば良い」「こう実装すれば解決する」といった解決策・修正方針を併記する場合、**必ず `CLAUDE.md` の upstream-policy に従った方針で書く**。雑に upstream owned のソースをいじる前提で書かない。upstream-policy を無視した案を issue に書くと、後で実装するときに同じ議論を一からやり直すことになる。

優先順:

1. **既存の opencode plugin 機構** で実装できるか先に検討する:
   - server-side hook (`tool.execute.before` / `tool.execute.after` / `chat.params` / `permission.ask` 等) → `packages/opencode/src/securecode/plugins/` に追加
   - TUI plugin (slot 差し替え / 独自 command / keybind 等) → `packages/opencode/src/securecode/tui-plugins/` に追加
2. **securecode 固有ファイル** (`packages/opencode/src/securecode/**`, `setup/**`, `install-securecode`, `script/release-securecode.ts`, `specs/**`, `.opencode/**`, `.claude/**` 等) の追加 / 変更で済むかを次に検討する。
3. それでも **upstream owned のソース** (`packages/opencode/**`, `packages/tui/**`, `packages/app/**`, `packages/core/**`, `packages/plugin/**`, `packages/sdk/**`, `packages/desktop/**` 等) を直接触るしかないと結論づけた場合は、**そう判断した理由を必ず本文に明記する**。理由が示せない場合は plugin / securecode 固有での実装パスをもう一度検討する。

純粋な UX 改善で plugin 化が構造的に不可能なケースは、原則として「対応見送り」または「手順書追記 / 既存 env var による opt-out」など、コードに触らない代替を提案する方向で本文を書く。

詳細は `CLAUDE.md` と `specs/upstream-policy.md` を参照。

### 5. issue 作成コマンド

```bash
gh issue create \
  -R acompany-develop/securecode \
  --title "<title>" \
  --body-file <(cat <<'EOF'
<本文>
EOF
) \
  --label "<label>" \
  --assignee "@me"
```

注意点:

- `-R acompany-develop/securecode` は **必須**。
- body は `--body-file` でヒアドキュメント経由を推奨 (改行・特殊文字の escape 事故を避ける)。
- label は `gh label list -R acompany-develop/securecode` で実在ラベルを確認してから付ける。存在しないラベルを指定すると失敗する。
- 作成後、`gh issue view <番号> -R acompany-develop/securecode` で内容を確認し、テンプレート項目が抜けていないか必ずチェックする。

### 6. コメント追記ルール

issue 本文やそのコメントを **編集してはいけない**。理由:

- コメントを編集するとレビュアーから編集履歴が見えづらく、議論の経緯が追えなくなる
- どの判断が最新で、なぜ変わったのかが分かりにくくなる

訂正・追記・撤回が必要なときの手順:

1. 古いコメント / issue 本文の該当箇所に **取り消し線** を引く (`~~取り消したい文~~`)。取り消し線を引く目的に限って、その編集だけは許可する。
2. 新規コメントで「先ほどの〇〇は誤りでした。正しくは△△です」と追記する。

`gh issue comment <番号> -R acompany-develop/securecode --body "..."` で新規コメントを追加する。本文の差し替え (gh の `--edit-last` や Web UI での編集) はしない。

例外: 投稿数秒以内の typo 即時修正、または誤って secret を貼ってしまった等の保安上必須のケースのみ、編集を許可する。ただしその場合も新規コメントで「先ほどのコメントを編集しました」と明示すること。

## チェックリスト

- [ ] **まず securecode 側で同じテーマの issue / PR を探した** (最優先)
- [ ] 次に upstream 側で同じテーマの issue / PR を探した
- [ ] 該当があればユーザーに報告し、判断を仰いだ
- [ ] `.github/ISSUE_TEMPLATE/` を確認し、適切なテンプレートを選んだ
- [ ] テンプレートの必須項目を全部埋めた
- [ ] `-R acompany-develop/securecode` を付けた
- [ ] ラベルが実在することを確認した
- [ ] 作成後に `gh issue view` で内容を確認した
