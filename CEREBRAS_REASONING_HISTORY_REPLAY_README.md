# Cerebras Reasoning History Replay Branch

This branch contains the local OpenCode fixes used to preserve assistant reasoning across follow-up turns for Cerebras-hosted reasoning models.

Branch:

`codex/cerebras-reasoning-history-replay`

Fork:

`https://github.com/ryanl-cerebras/opencode`

Upstream PR reference:

`https://github.com/anomalyco/opencode/pull/26763`

## What is in this branch

- `fix(opencode): replay Cerebras reasoning in assistant content`
- `test(opencode): cover kimi and glm reasoning replay`
- `fix(provider): default reasoning replay for kimi and glm`

The branch was revalidated on May 20, 2026 on macOS arm64 with:

- `bun test test/provider/provider.test.ts test/provider/transform.test.ts`
- `bun ./packages/opencode/script/build.ts --single`
- A live Kimi K2.6 tool-call test on Cerebras

## Important note for Kimi K2.6 on Cerebras

This branch does **not** add `moonshotai-kimi-k2.6` to the stock `cerebras` model catalog shown by `opencode models cerebras`.

For testing Kimi K2.6 on Cerebras, use a custom provider config that points at the Cerebras SDK path with `@ai-sdk/cerebras`. That is the path validated for this branch.

## Clone and build

```bash
git clone https://github.com/ryanl-cerebras/opencode.git
cd opencode
git checkout codex/cerebras-reasoning-history-replay
bun install
bun test test/provider/provider.test.ts test/provider/transform.test.ts
bun ./packages/opencode/script/build.ts --single
```

The built binary will be at:

```bash
./packages/opencode/dist/opencode-<platform>/bin/opencode
```

On macOS Apple Silicon, the tested path is:

```bash
./packages/opencode/dist/opencode-darwin-arm64/bin/opencode
```

## Kimi K2.6 test setup

Set your Cerebras key. If you keep it in `SA_API_KEY`, map it over for the test session:

```bash
export CEREBRAS_API_KEY="$SA_API_KEY"
```

Create a temporary OpenCode config file:

```json
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
```

For example, save it as `opencode.kimi-k26.cerebras.json`.

Then point OpenCode at that config and use a fresh local DB:

```bash
export OPENCODE_CONFIG="$PWD/opencode.kimi-k26.cerebras.json"
export OPENCODE_DB=/tmp/opencode-k26-test.db
```

## Live test command

This is the exact tool-call flow revalidated on May 20, 2026:

```bash
./packages/opencode/dist/opencode-darwin-arm64/bin/opencode run \
  --pure \
  --dangerously-skip-permissions \
  -m cerebras-custom/moonshotai-kimi-k2.6 \
  "Do not modify files. Run pwd once via bash, then reply with exactly K2.6_TOOL_OK."
```

Expected output:

```text
$ pwd
...
K2.6_TOOL_OK
```

## Simple text-only smoke test

```bash
./packages/opencode/dist/opencode-darwin-arm64/bin/opencode run \
  --pure \
  -m cerebras-custom/moonshotai-kimi-k2.6 \
  "Reply with exactly K2.6_OK."
```

Expected output:

```text
K2.6_OK.
```

## If you want to compare against an unpatched release

The failure mode this branch is intended to fix is a follow-up turn error like:

```text
Bad Request: messages.2.assistant.reasoning_content: property 'messages.2.assistant.reasoning_content' is unsupported
```

If you see that on this branch while using the `cerebras-custom` config above, the branch is not being picked up correctly.
