# Cerebras Reasoning History Replay Branch

This document is written to be safe for copy-paste into another LLM session. It is intentionally explicit and redundant.

## Use this exact repo and branch

- Repo: `https://github.com/ryanl-cerebras/opencode.git`
- Branch: `codex/cerebras-reasoning-history-replay`
- Upstream PR reference: `https://github.com/anomalyco/opencode/pull/26763`

Do **not** use:

- `https://github.com/anomalyco/opencode.git`
- a Homebrew or npm-installed `opencode`
- any other branch

The goal is to build and run the patched binary from this fork branch.

## What this branch contains

The branch should include these commits in its history:

- `603ae2ffa` `fix(opencode): replay Cerebras reasoning in assistant content`
- `ee2fa6b64` `test(opencode): cover kimi and glm reasoning replay`
- `da4f7e820` `fix(provider): default reasoning replay for kimi and glm`

The branch README itself was added in:

- `c411f7ce7` `docs: add Cerebras branch usage notes`

## Operator rules for another LLM

If you are another LLM following this file, do this exactly:

1. Clone the fork URL above, not the upstream repository.
2. Check out `codex/cerebras-reasoning-history-replay`.
3. Verify that commit `da4f7e820` is an ancestor of `HEAD`.
4. Build the binary from the cloned repo.
5. Run the built binary from the repo `dist` directory. Do not use a globally installed `opencode`.
6. If `CEREBRAS_API_KEY` is missing but `SA_API_KEY` exists, export `CEREBRAS_API_KEY="$SA_API_KEY"`.
7. Use the custom `@ai-sdk/cerebras` provider config in this document for `moonshotai-kimi-k2.6`.
8. Use a fresh `OPENCODE_DB` path for the test run.
9. Treat this error as a failure:

```text
Bad Request: messages.2.assistant.reasoning_content: property 'messages.2.assistant.reasoning_content' is unsupported
```

## Prerequisites

- `git`
- `bun` on `PATH`
- a valid Cerebras key in either `CEREBRAS_API_KEY` or `SA_API_KEY`

If `bun` is missing, install it first:

```bash
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

## One-block runbook

This block is intended to be copy-pasted as a single unit.

```bash
set -euo pipefail

WORKDIR="$(mktemp -d /tmp/opencode-cerebras-k26.XXXXXX)"
REPO_URL="https://github.com/ryanl-cerebras/opencode.git"
BRANCH="codex/cerebras-reasoning-history-replay"

echo "WORKDIR=$WORKDIR"

git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$WORKDIR/opencode"
cd "$WORKDIR/opencode"

ACTUAL_REMOTE="$(git remote get-url origin)"
ACTUAL_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

test "$ACTUAL_REMOTE" = "$REPO_URL"
test "$ACTUAL_BRANCH" = "$BRANCH"

git merge-base --is-ancestor 603ae2ffa HEAD
git merge-base --is-ancestor ee2fa6b64 HEAD
git merge-base --is-ancestor da4f7e820 HEAD

if [ -z "${CEREBRAS_API_KEY:-}" ]; then
  if [ -n "${SA_API_KEY:-}" ]; then
    export CEREBRAS_API_KEY="$SA_API_KEY"
  else
    echo "Missing CEREBRAS_API_KEY and SA_API_KEY" >&2
    exit 1
  fi
fi

bun --version
bun install
bun test test/provider/provider.test.ts test/provider/transform.test.ts
bun ./packages/opencode/script/build.ts --single

BIN="$(find "$WORKDIR/opencode/packages/opencode/dist" -type f -name opencode | head -n 1)"

if [ -z "$BIN" ]; then
  echo "Could not find built opencode binary under packages/opencode/dist" >&2
  exit 1
fi

"$BIN" --version

cat > "$WORKDIR/opencode/opencode.kimi-k26.cerebras.json" <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "cerebras-custom": {
      "name": "Cerebras Custom",
      "npm": "@ai-sdk/cerebras",
      "options": {
        "apiKey": "{env:CEREBRAS_API_KEY}",
        "headers": {
          "X-Cerebras-3rd-Party-Integration": "opencode"
        }
      },
      "models": {
        "moonshotai-kimi-k2.6": {
          "name": "MoonshotAI Kimi K2.6",
          "id": "moonshotai-kimi-k2.6",
          "reasoning": true
        }
      }
    }
  }
}
EOF

export OPENCODE_CONFIG="$WORKDIR/opencode/opencode.kimi-k26.cerebras.json"
export OPENCODE_DB="$WORKDIR/opencode/opencode-k26-test.db"

"$BIN" run \
  --pure \
  -m cerebras-custom/moonshotai-kimi-k2.6 \
  "Reply with exactly K2.6_OK."

"$BIN" run \
  --pure \
  --dangerously-skip-permissions \
  -m cerebras-custom/moonshotai-kimi-k2.6 \
  "Do not modify files. Run pwd once via bash, then reply with exactly K2.6_TOOL_OK."
```

## Expected successful outputs

The text-only smoke test should end with:

```text
K2.6_OK.
```

The tool-call test should look like:

```text
$ pwd
/some/path
K2.6_TOOL_OK
```

## Manual step-by-step version

If you do not want the one-block runbook, use these exact steps instead.

### 1. Clone the correct fork and branch

```bash
git clone https://github.com/ryanl-cerebras/opencode.git
cd opencode
git checkout codex/cerebras-reasoning-history-replay
git remote get-url origin
git rev-parse --abbrev-ref HEAD
git merge-base --is-ancestor da4f7e820 HEAD
```

Expected:

- remote URL is `https://github.com/ryanl-cerebras/opencode.git`
- branch is `codex/cerebras-reasoning-history-replay`
- `git merge-base --is-ancestor da4f7e820 HEAD` exits `0`

### 2. Build the branch

```bash
bun install
bun test test/provider/provider.test.ts test/provider/transform.test.ts
bun ./packages/opencode/script/build.ts --single
```

### 3. Locate and verify the built binary

```bash
find ./packages/opencode/dist -type f -name opencode
```

On macOS Apple Silicon, the tested path was:

```bash
./packages/opencode/dist/opencode-darwin-arm64/bin/opencode
```

Then verify it:

```bash
./packages/opencode/dist/opencode-darwin-arm64/bin/opencode --version
```

### 4. Export the Cerebras key

If you already have `CEREBRAS_API_KEY`, keep using it.

If you only have `SA_API_KEY`, map it over:

```bash
export CEREBRAS_API_KEY="$SA_API_KEY"
```

### 5. Write the K2.6 config file

```bash
cat > opencode.kimi-k26.cerebras.json <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "cerebras-custom": {
      "name": "Cerebras Custom",
      "npm": "@ai-sdk/cerebras",
      "options": {
        "apiKey": "{env:CEREBRAS_API_KEY}",
        "headers": {
          "X-Cerebras-3rd-Party-Integration": "opencode"
        }
      },
      "models": {
        "moonshotai-kimi-k2.6": {
          "name": "MoonshotAI Kimi K2.6",
          "id": "moonshotai-kimi-k2.6",
          "reasoning": true
        }
      }
    }
  }
}
EOF
```

### 6. Point OpenCode at the config and a fresh DB

```bash
export OPENCODE_CONFIG="$PWD/opencode.kimi-k26.cerebras.json"
export OPENCODE_DB=/tmp/opencode-k26-test.db
```

### 7. Run the smoke test

```bash
./packages/opencode/dist/opencode-darwin-arm64/bin/opencode run \
  --pure \
  -m cerebras-custom/moonshotai-kimi-k2.6 \
  "Reply with exactly K2.6_OK."
```

### 8. Run the tool-call validation

```bash
./packages/opencode/dist/opencode-darwin-arm64/bin/opencode run \
  --pure \
  --dangerously-skip-permissions \
  -m cerebras-custom/moonshotai-kimi-k2.6 \
  "Do not modify files. Run pwd once via bash, then reply with exactly K2.6_TOOL_OK."
```

## Why the custom provider config is required

This branch fixes the Cerebras reasoning replay path, but it does **not** add `moonshotai-kimi-k2.6` to the built-in `cerebras` model list.

So this will not be enough:

```bash
opencode models cerebras
```

The stock catalog may still omit K2.6. The custom `cerebras-custom` provider above is the tested way to run K2.6 against Cerebras on this branch.

## Failure diagnosis

If the run fails, check these in order:

1. You cloned `ryanl-cerebras/opencode`, not `anomalyco/opencode`.
2. You are on `codex/cerebras-reasoning-history-replay`.
3. `git merge-base --is-ancestor da4f7e820 HEAD` succeeds.
4. You are running the locally built binary from `packages/opencode/dist/.../opencode`.
5. `CEREBRAS_API_KEY` is exported in the shell running OpenCode.
6. `OPENCODE_CONFIG` points to the custom `cerebras-custom` JSON file in this document.
7. `OPENCODE_DB` points to a fresh path.

If you still see:

```text
Bad Request: messages.2.assistant.reasoning_content: property 'messages.2.assistant.reasoning_content' is unsupported
```

then the patched branch is not being used correctly, or the model is not going through the custom `@ai-sdk/cerebras` provider path described here.
