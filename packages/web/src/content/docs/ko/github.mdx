---
title: GitHub
description: GitHub issue와 pull request에서 OpenCode를 사용하세요.
---

OpenCode는 GitHub 워크플로와 통합됩니다. 댓글에 `/opencode` 또는 `/oc`를 mention하면 OpenCode가 GitHub Actions runner 안에서 작업을 실행합니다.

---

## 기능

- **Issue triage**: OpenCode에게 issue를 분석하고 내용을 설명하도록 요청할 수 있습니다.
- **Fix and implement**: OpenCode에게 issue 수정이나 기능 구현을 요청할 수 있습니다. 새 branch에서 작업한 뒤 변경 사항을 담은 PR을 생성합니다.
- **Secure**: OpenCode는 GitHub runner 내부에서 실행됩니다.

---

## 설치

GitHub repo에 연결된 프로젝트에서 아래 명령을 실행하세요.

```bash
opencode github install
```

이 명령은 GitHub app 설치, workflow 생성, secrets 설정 과정을 안내합니다.

---

### Manual Setup

원하면 수동으로도 설정할 수 있습니다.

1. **Install the GitHub app**

   [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent)로 이동하세요. 대상 repo에 app이 설치되어 있는지 확인하세요.

2. **Add the workflow**

   아래 workflow 파일을 repo의 `.github/workflows/opencode.yml`에 추가하세요. `env`에는 필요한 API key를 넣고, `model`은 환경에 맞게 설정하세요.

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

3. **Store the API keys in secrets**

   조직 또는 프로젝트 **Settings**에서 왼쪽의 **Secrets and variables**를 펼친 뒤 **Actions**를 선택하세요. 필요한 API key를 추가하면 됩니다.

---

## 구성

- `model`: OpenCode에서 사용할 model입니다. `provider/model` 형식이며 **필수**입니다.
- `agent`: 사용할 agent입니다. primary agent여야 합니다. 찾지 못하면 config의 `default_agent`를 사용하고, 그것도 없으면 `"build"`로 fallback합니다.
- `share`: OpenCode 세션 공유 여부입니다. public repo에서는 기본값이 **true**입니다.
- `prompt`: 기본 동작을 override하는 선택형 custom prompt입니다. OpenCode의 요청 처리 방식을 조정할 때 사용합니다.
- `token`: 댓글 생성, 커밋, PR 생성 같은 작업을 수행할 때 사용하는 선택형 GitHub access token입니다. 기본적으로 OpenCode는 OpenCode GitHub App의 installation access token을 사용하므로, 커밋/댓글/PR 작성 주체가 app으로 표시됩니다.

  또는 OpenCode GitHub App을 설치하지 않고도 GitHub Action runner의 [기본 제공 `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)을 사용할 수 있습니다. 이 경우 workflow에 필요한 permission을 반드시 부여하세요.

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  필요하면 [personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT)도 사용할 수 있습니다.

---

## Supported Events

OpenCode는 아래 GitHub event로 트리거할 수 있습니다.

| Event Type                    | Triggered By            | Details                                                                                                                |
| ----------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `issue_comment`               | issue 또는 PR 댓글      | 댓글에 `/opencode` 또는 `/oc`를 mention하세요. OpenCode가 맥락을 읽고 branch 생성, PR 생성, 답변을 수행할 수 있습니다. |
| `pull_request_review_comment` | PR의 특정 코드 줄 댓글  | 코드 리뷰 중 `/opencode` 또는 `/oc`를 mention하세요. OpenCode가 파일 경로, 라인 번호, diff 맥락을 받습니다.            |
| `issues`                      | issue 생성 또는 수정    | issue가 생성/수정될 때 OpenCode를 자동 트리거합니다. `prompt` 입력이 필요합니다.                                       |
| `pull_request`                | PR 생성 또는 업데이트   | PR open/synchronize/reopen 시 OpenCode를 자동 트리거합니다. 자동 리뷰에 유용합니다.                                    |
| `schedule`                    | cron 기반 스케줄        | 스케줄에 따라 OpenCode를 실행합니다. `prompt` 입력이 필요합니다. 출력은 로그와 PR로 남습니다(issue 댓글 대상 없음).    |
| `workflow_dispatch`           | GitHub UI에서 수동 실행 | Actions 탭에서 필요 시 OpenCode를 실행합니다. `prompt` 입력이 필요하며 출력은 로그와 PR로 남습니다.                    |

### Schedule Example

자동화 작업을 위해 스케줄 기반으로 OpenCode를 실행할 수 있습니다.

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

schedule event는 지시를 추출할 댓글이 없기 때문에 `prompt` 입력이 **필수**입니다. 또한 schedule workflow는 permission 체크용 사용자 맥락 없이 실행되므로, OpenCode가 branch나 PR을 만들게 하려면 `contents: write`와 `pull-requests: write`를 부여해야 합니다.

---

### Pull Request Example

PR이 열리거나 업데이트될 때 자동 리뷰를 수행할 수 있습니다.

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

`pull_request` event에서 `prompt`를 지정하지 않으면 OpenCode는 pull request 리뷰를 기본 동작으로 수행합니다.

---

### Issues Triage Example

새로운 issue를 자동으로 triage할 수 있습니다. 아래 예시는 스팸을 줄이기 위해 계정 생성 후 30일 이상인 사용자만 대상으로 필터링합니다.

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

`issues` event 역시 지시를 추출할 댓글이 없기 때문에 `prompt` 입력이 **필수**입니다.

---

## Custom prompts

기본 prompt를 override해 워크플로에 맞게 OpenCode 동작을 커스터마이즈할 수 있습니다.

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

이 방식은 프로젝트별 리뷰 기준, 코딩 표준, 중점 점검 항목을 강제할 때 유용합니다.

---

## 예시

아래는 GitHub에서 OpenCode를 활용하는 대표 예시입니다.

- **Issue 설명 요청**

  GitHub issue에 아래 댓글을 남기세요.

  ```
  /opencode explain this issue
  ```

  OpenCode는 전체 스레드와 모든 댓글을 읽고 명확한 설명으로 답변합니다.

- **Issue 수정 요청**

  GitHub issue에서 아래처럼 요청하세요.

  ```
  /opencode fix this
  ```

  OpenCode가 새 branch를 만들고 변경을 구현한 뒤, 변경 사항이 담긴 PR을 생성합니다.

- **PR 리뷰 중 변경 요청**

  GitHub PR에 아래 댓글을 남기세요.

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  OpenCode가 요청한 변경을 구현하고 같은 PR에 커밋합니다.

- **특정 코드 줄 리뷰 요청**

  PR의 "Files" 탭에서 코드 줄에 직접 댓글을 남기세요. OpenCode는 파일, 줄 번호, diff 맥락을 자동으로 인식해 더 정확한 응답을 제공합니다.

  ```
  [Comment on specific lines in Files tab]
  /oc add error handling here
  ```

  특정 줄 댓글에서는 OpenCode가 다음 정보를 함께 받습니다.
  - 검토 중인 정확한 파일
  - 해당 코드 줄
  - 주변 diff 맥락
  - 라인 번호 정보

  따라서 파일 경로나 라인 번호를 직접 적지 않아도 더 정밀하게 요청할 수 있습니다.
