---
title: GitHub
description: 在 GitHub Issue 和 Pull Request 中使用 OpenCode。
---

OpenCode 可以與您的 GitHub 工作流程整合。在評論中提及 `/opencode` 或 `/oc`，OpenCode 就會在您的 GitHub Actions Runner 中執行任務。

---

## 功能特性

- **Issue 分類**：讓 OpenCode 調查某個 Issue 並為您做出解釋。
- **修復與實作**：讓 OpenCode 修復 Issue 或實作某個功能。它會在新分支中工作，並提交包含所有變更的 PR。
- **安全可靠**：OpenCode 在您自己的 GitHub Runner 中執行。

---

## 安裝

在一個位於 GitHub 儲存庫中的專案裡執行以下指令：

```bash
opencode github install
```

該指令會引導您完成 GitHub App 的安裝、工作流程的建立以及密鑰的設定。

---

### 手動設定

您也可以手動進行設定。

1. **安裝 GitHub App**

   前往 [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent)，確保已在目標儲存庫中安裝該應用程式。

2. **新增工作流程**

   將以下工作流程檔案新增到儲存庫的 `.github/workflows/opencode.yml` 中。請確保在 `env` 中設定合適的 `model` 及所需的 API 金鑰。

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

3. **將 API 金鑰儲存到 Secrets 中**

   在您的組織或專案的 **Settings** 中，展開左側的 **Secrets and variables**，然後選擇 **Actions**，新增所需的 API 金鑰。

---

## 設定

- `model`：OpenCode 使用的模型，格式為 `provider/model`。此項為**必填**。
- `agent`：要使用的代理，必須是主代理。如果未找到，則回退到設定中的 `default_agent`，若仍未找到則使用 `"build"`。
- `share`：是否共享 OpenCode 工作階段。對於公開儲存庫，預設為 **true**。
- `prompt`：可選的自訂提示詞，用於覆寫預設行為。可透過此項自訂 OpenCode 處理請求的方式。
- `token`：可選的 GitHub 存取權杖，用於執行建立評論、提交變更和建立 Pull Request 等操作。預設情況下，OpenCode 使用 OpenCode GitHub App 的安裝存取權杖，因此提交、評論和 Pull Request 會顯示為來自該應用程式。

  您也可以使用 GitHub Action Runner 內建的 [`GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)，而無需安裝 OpenCode GitHub App。只需確保在工作流程中授予所需的權限：

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  如果您願意，也可以使用[個人存取權杖](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)（PAT）。

---

## 支援的事件

OpenCode 可以由以下 GitHub 事件觸發：

| 事件類型                      | 觸發方式                       | 詳情                                                                                      |
| ----------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `issue_comment`               | 在 Issue 或 PR 上發表評論      | 在評論中提及 `/opencode` 或 `/oc`。OpenCode 會讀取上下文，並可建立分支、提交 PR 或回覆。  |
| `pull_request_review_comment` | 在 PR 中對特定程式碼行發表評論 | 在程式碼審查時提及 `/opencode` 或 `/oc`。OpenCode 會接收檔案路徑、行號和 diff 上下文。    |
| `issues`                      | Issue 被建立或編輯             | 在 Issue 建立或修改時自動觸發 OpenCode。需要提供 `prompt` 輸入。                          |
| `pull_request`                | PR 被建立或更新                | 在 PR 被開啟、同步或重新開啟時自動觸發 OpenCode。適用於自動化審查情境。                   |
| `schedule`                    | 基於 Cron 的定時任務           | 按排程執行 OpenCode。需要提供 `prompt` 輸入。輸出會寫入日誌和 PR（沒有 Issue 可供評論）。 |
| `workflow_dispatch`           | 從 GitHub UI 手動觸發          | 透過 Actions 分頁按需觸發 OpenCode。需要提供 `prompt` 輸入。輸出會寫入日誌和 PR。         |

### 定時任務範例

按排程執行 OpenCode 以執行自動化任務：

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

對於定時事件，`prompt` 輸入為**必填**，因為沒有評論可供提取指令。定時工作流程在執行時沒有使用者上下文來進行權限檢查，因此如果您希望 OpenCode 建立分支或 PR，工作流程必須授予 `contents: write` 和 `pull-requests: write` 權限。

---

### Pull Request 範例

在 PR 被建立或更新時自動進行審查：

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

對於 `pull_request` 事件，如果未提供 `prompt`，OpenCode 將預設對該 Pull Request 進行審查。

---

### Issue 分類範例

自動分類新建的 Issue。以下範例會過濾掉註冊不滿 30 天的帳戶以減少垃圾訊息：

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

對於 `issues` 事件，`prompt` 輸入為**必填**，因為沒有評論可供提取指令。

---

## 自訂提示詞

覆寫預設提示詞，以便為您的工作流程自訂 OpenCode 的行為。

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

這對於在專案中實施特定的審查標準、編碼規範或關注重點非常有用。

---

## 範例

以下是在 GitHub 中使用 OpenCode 的一些範例。

- **解釋 Issue**

  在 GitHub Issue 中新增以下評論：

  ```
  /opencode explain this issue
  ```

  OpenCode 會閱讀整個討論串（包括所有評論），並回覆一份清晰的解釋。

- **修復 Issue**

  在 GitHub Issue 中輸入：

  ```
  /opencode fix this
  ```

  OpenCode 會建立一個新分支，實作變更，並提交一個包含所有修改的 PR。

- **審查 PR 並進行修改**

  在 GitHub PR 上留下以下評論：

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  OpenCode 會實作所請求的變更並將其提交到同一個 PR 中。

- **審查特定程式碼行**

  在 PR 的「Files」分頁中直接對程式碼行留下評論。OpenCode 會自動偵測檔案、行號和 diff 上下文，從而提供精準的回應。

  ```
  [Comment on specific lines in Files tab]
  /oc add error handling here
  ```

  當您對特定程式碼行發表評論時，OpenCode 會接收到：
  - 正在審查的具體檔案
  - 特定的程式碼行
  - 周圍的 diff 上下文
  - 行號資訊

  這樣您就可以提出更有針對性的請求，而無需手動指定檔案路徑或行號。
