# opencode Gitea Action

A Gitea Action that integrates [opencode](https://opencode.ai) directly into your Gitea/Forgejo workflow.

Mention `/opencode` or `/oc` in your comment, and opencode will execute tasks within your Gitea Actions runner.

## Features

#### Explain an issue

Leave the following comment on a Gitea issue. opencode will read the entire thread, including all comments, and reply with a clear explanation.

```
/opencode explain this issue
```

#### Fix an issue

Leave the following comment on a Gitea issue. opencode will create a new branch, implement the changes, and open a PR with the changes.

```
/opencode fix this
```

#### Review PRs and make changes

Leave the following comment on a Gitea PR. opencode will implement the requested change and commit it to the same PR.

```
Delete the attachment from S3 when the note is removed /oc
```

## Installation

Run the following command in the terminal from your Gitea repo:

```bash
opencode gitea install
```

This will walk you through creating the workflow and setting up secrets.

### Manual Setup

1. Create a Gitea Personal Access Token with `repo` scope
2. Add the token as a secret named `OPENCODE_GIT_TOKEN` in your repository settings
3. Add the following workflow file to `.gitea/workflows/opencode.yml` in your repo:

   ```yml
   name: opencode

   on:
     issue_comment:
       types: [created]

   jobs:
     opencode:
       if: |
         contains(github.event.comment.body, '/oc') ||
         startsWith(github.event.comment.body, '/oc') ||
         contains(github.event.comment.body, '/opencode') ||
         startsWith(github.event.comment.body, '/opencode')
       runs-on: linux
       container: catthehacker/ubuntu:act-latest
       steps:
         - name: Checkout repository
           uses: actions/checkout@v4
           with:
             persist-credentials: false

         - name: Install Bun
           run: |
             curl -fsSL https://bun.sh/install | bash
             echo "$HOME/.bun/bin" >> $GITHUB_PATH

         - name: Install opencode
           run: ~/.bun/bin/bun install -g opencode-ai@latest

         - name: Run opencode
           env:
             OPENCODE_GIT_TOKEN: ${{ secrets.OPENCODE_GIT_TOKEN }}
             OPENCODE_GIT_URL: ${{ gitea.server_url }}
             ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
             MODEL: anthropic/claude-sonnet-4-20250514
           run: opencode gitea run
   ```

4. Store the API keys in secrets. In your repository **Settings** → **Actions** → **Secrets**, add the required API keys.

> **Note**: The `runs-on` and `container` values depend on your Gitea runner configuration. The example above uses `linux` with `catthehacker/ubuntu:act-latest`, which is common for [act_runner](https://gitea.com/gitea/act_runner). Adjust these values to match your runner setup.

## Environment Variables

| Variable                | Description                                              | Required |
| ----------------------- | -------------------------------------------------------- | -------- |
| `OPENCODE_GIT_TOKEN`    | Personal Access Token with repo scope                    | Yes      |
| `OPENCODE_GIT_URL`      | Gitea instance URL (auto-detected in Actions)            | Yes      |
| `MODEL`                 | Model to use (e.g. `anthropic/claude-sonnet-4-20250514`) | Yes      |
| `PROMPT`                | Custom prompt to override default                        | No       |
| `MENTIONS`              | Trigger phrases (default: `/opencode,/oc`)               | No       |
| `OPENCODE_BOT_USERNAME` | Bot username for commits (default: `opencode-bot`)       | No       |

## Support

This is an early release. If you encounter issues or have feedback, please create an issue at https://github.com/anomalyco/opencode/issues.

## Codeberg / Forgejo

This action also works with Forgejo instances like Codeberg. Note that Codeberg has stricter rate limits (30 requests/minute), so the action automatically adjusts its behavior accordingly.
