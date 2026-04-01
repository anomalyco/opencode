---
title: GitHub
description: GitHub の問題とプルリクエストで OpenCode を使用します。
---

OpenCode は GitHub ワークフローと統合します。コメントで `/opencode` または `/oc` に言及すると、OpenCode が GitHub Actions ランナー内でタスクを実行します。

---

## 機能

- **問題のトリアージ**: OpenCode に問題を調べて説明してもらいます。
- **修正と実装**: OpenCode に問題の修正または機能の実装を依頼します。そして、新しいブランチで動作し、すべての変更を含む PR を送信します。
- **安全**: OpenCode は GitHub のランナー内で実行されます。

---

## インストール

GitHub リポジトリにあるプロジェクトで次のコマンドを実行します。

```bash
opencode github install
```

ここでは、GitHub アプリのインストール、ワークフローの作成、シークレットの設定について説明します。

---

### 手動セットアップ

または、手動で設定することもできます。

1. **GitHub アプリをインストールします**

[**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent) にアクセスしてください。ターゲットリポジトリにインストールされていることを確認してください。

2. **ワークフローを追加**

次のワークフローファイルをリポジトリの `.github/workflows/opencode.yml` に追加します。適切な `model` と必要な API キーを `env` に設定してください。

```yml title=".github/workflows/opencode.yml" {24,26}
   name: opencode

   on:
     issue_comment:
       types: [created]
     pull_request_review_comment:
       types: [created]

   jobs:
     opencode:
       if: |
         contains(github.event.comment.body, '/oc') ||
         contains(github.event.comment.body, '/opencode')
       runs-on: ubuntu-latest
       permissions:
         id-token: write
       steps:
          - name: Checkout repository
            uses: actions/checkout@v6
            with:
              fetch-depth: 1
              persist-credentials: false

          - name: Run OpenCode
           uses: anomalyco/opencode/github@latest
           env:
             ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
           with:
             model: anthropic/claude-sonnet-4-20250514
             # share: true
             # github_token: xxxx
```

3. **API キーをシークレットに保存する**

組織またはプロジェクトの**設定**で、左側の**シークレットと変数**を展開し、**アクション**を選択します。そして、必要な API キーを追加します。

---

## 設定

- `model`: OpenCode で使用するモデル。 `provider/model` の形式をとります。これは**必須**です。
- `agent`: 使用するエージェント。プライマリエージェントである必要があります。見つからない場合は、設定から `default_agent` にフォールバックするか、`"build"` にフォールバックします。
- `share`: OpenCode セッションを共有するかどうか。パブリックリポジトリのデフォルトは **true** です。
- `prompt`: デフォルトの動作をオーバーライドするためのオプションのカスタムプロンプト。これを使用して、OpenCode がリクエストを処理する方法をカスタマイズします。
- `token`: コメントの作成、変更のコミット、プルリクエストのオープンなどの操作を実行するためのオプションの GitHub アクセストークン。デフォルトでは、OpenCode は OpenCode GitHub アプリからのインストールアクセストークンを使用するため、コミット、コメント、プルリクエストはアプリからのものとして表示されます。

あるいは、OpenCode GitHub アプリをインストールせずに、GitHub Action ランナーの [組み込み `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) を使用することもできます。ワークフローで必要な権限を必ず付与してください。

```yaml
permissions:
  id-token: write
  contents: write
  pull-requests: write
  issues: write
```

必要に応じて、[パーソナルアクセストークン](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT) を使用することもできます。

---

## サポートされているイベント

OpenCode は、次の GitHub イベントによってトリガーできます。

| イベントの種類                | トリガー                            | 詳細                                                                                                                                                        |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue_comment`               | 問題または PR についてコメントする  | コメントで `/opencode` または `/oc` について言及してください。 OpenCode はコンテキストを読み取り、ブランチを作成したり、PR を開いたり、返信したりできます。 |
| `pull_request_review_comment` | PR 内の特定のコード行にコメントする | コードをレビューするときに、`/opencode` または `/oc` について言及します。 OpenCode は、ファイルパス、行番号、および diff コンテキストを受け取ります。       |
| `issues`                      | 問題がオープンまたは編集されました  | 問題が作成または変更されると、OpenCode が自動的にトリガーされます。 `prompt` 入力が必要です。                                                               |
| `pull_request`                | PR がオープンまたは更新されました   | PR が開かれる、同期される、または再度開かれるときに、OpenCode を自動的にトリガーします。自動レビューに役立ちます。                                          |
| `schedule`                    | Cron ベースのスケジュール           | スケジュールに従って OpenCode を実行します。 `prompt` 入力が必要です。出力はログと PR に送られます (コメントする問題はありません)。                         |
| `workflow_dispatch`           | GitHub UI からの手動トリガー        | [アクション] タブから OpenCode をオンデマンドでトリガーします。 `prompt` 入力が必要です。出力はログと PR に送られます。                                     |

### スケジュールの例

スケジュールに従って OpenCode を実行し、自動化されたタスクを実行します。

```yaml title=".github/workflows/opencode-scheduled.yml"
name: Scheduled OpenCode Task

on:
  schedule:
    - cron: "0 9 * * 1" # Every Monday at 9am UTC

jobs:
  opencode:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Run OpenCode
        uses: anomalyco/opencode/github@latest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          prompt: |
            Review the codebase for any TODO comments and create a summary.
            If you find issues worth addressing, open an issue to track them.
```

スケジュールされたイベントの場合、指示を抽出するためのコメントがないため、`prompt` 入力は **必須** です。スケジュールされたワークフローは、権限チェックのためのユーザーコンテキストなしで実行されるため、OpenCode がブランチまたは PR を作成することが予想される場合、ワークフローは `contents: write` および `pull-requests: write` を付与する必要があります。

---

### プルリクエストの例

PR が開かれるか更新されるときに、PR を自動的にレビューします。

```yaml title=".github/workflows/opencode-review.yml"
name: opencode-review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: read
      issues: read
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: anomalyco/opencode/github@latest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          use_github_token: true
          prompt: |
            Review this pull request:
            - Check for code quality issues
            - Look for potential bugs
            - Suggest improvements
```

`pull_request` イベントの場合、`prompt` が指定されていない場合、OpenCode はデフォルトでプルリクエストをレビューします。

---

### Issueのトリアージの例

新しい問題を自動的に優先順位付けします。この例では、スパムを減らすために 30 日より古いアカウントにフィルターを適用します。

```yaml title=".github/workflows/opencode-triage.yml"
name: Issue Triage

on:
  issues:
    types: [opened]

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Check account age
        id: check
        uses: actions/github-script@v7
        with:
          script: |
            const user = await github.rest.users.getByUsername({
              username: context.payload.issue.user.login
            });
            const created = new Date(user.data.created_at);
            const days = (Date.now() - created) / (1000 * 60 * 60 * 24);
            return days >= 30;
          result-encoding: string

      - uses: actions/checkout@v6
        if: steps.check.outputs.result == 'true'
        with:
          persist-credentials: false

      - uses: anomalyco/opencode/github@latest
        if: steps.check.outputs.result == 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          prompt: |
            Review this issue. If there's a clear fix or relevant docs:
            - Provide documentation links
            - Add error handling guidance for code examples
            Otherwise, do not comment.
```

`issues` イベントの場合、指示を抽出するためのコメントがないため、`prompt` 入力は **必須** です。

---

## カスタムプロンプト

デフォルトのプロンプトをオーバーライドして、ワークフローに合わせて OpenCode の動作をカスタマイズします。

```yaml title=".github/workflows/opencode.yml"
- uses: anomalyco/opencode/github@latest
  with:
    model: anthropic/claude-sonnet-4-5
    prompt: |
      Review this pull request:
      - Check for code quality issues
      - Look for potential bugs
      - Suggest improvements
```

これは、プロジェクトに関連する特定のレビュー基準、コーディング標準、または重点分野を強制するのに役立ちます。

---

## 例

GitHub で OpenCode を使用する方法の例をいくつか示します。

- **Issueの説明**

このコメントを GitHub の問題に追加します。

```
  /opencode explain this issue
```

OpenCode は、すべてのコメントを含むスレッド全体を読み取り、明確な説明を返信します。

- **Issueの修正**

GitHub の問題で次のように言います。

```
  /opencode fix this
```

そして、OpenCode は新しいブランチを作成し、変更を実装し、変更を含む PR を開きます。

- **PR をレビューして変更を加える**

GitHub PR に次のコメントを残してください。

```
  Delete the attachment from S3 when the note is removed /oc
```

OpenCode は要求された変更を実装し、同じ PR にコミットします。

- **特定のコード行のレビュー**

PR の「ファイル」タブのコード行に直接コメントを残します。 OpenCode は、ファイル、行番号、および diff コンテキストを自動的に検出して、正確な応答を提供します。

```
  [Comment on specific lines in Files tab]
  /oc add error handling here
```

特定の行にコメントすると、OpenCode は以下を受け取ります。

- レビューされている正確なファイル
- コードの特定の行
- 周囲の差分コンテキスト
- 行番号情報

これにより、ファイルパスや行番号を手動で指定する必要がなく、よりターゲットを絞ったリクエストが可能になります。
