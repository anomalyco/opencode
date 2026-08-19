# Auto mode, /btw command, and model size display

## Why

### Problem 1: Permission friction blocks autonomous work

The current `--dangerously-skip-permissions` flag is a blunt instrument — it disables ALL permission checks, including safety-critical ones. Claude Code's `auto` mode provides a better pattern: a classifier-based approach that auto-approves safe actions (file reads, local writes) while routing risky actions (shell commands, network calls, production deploys) through a safety classifier. Users want full autonomy without the security risk of bypassing all checks.

### Problem 2: No way to ask side questions during agent work

Claude Code's `/btw` command lets users ask quick questions without cluttering conversation history. When the agent is mid-task (especially in a loop), users need to ask "what was that config file name?" or "what did we decide about X?" without derailing the main work or adding noise to the context window.

### Problem 3: Model size (GB) not visible outside the repo

Local llama-skein models report `size_bytes` in their `/v1/models` endpoint, and the `Model.sizeBytes` field exists in the schema (`provider.ts:1114`), but it's never populated or displayed outside the repo where the llama-skein backend is directly accessible. The `discoverOpenAICompatibleModels` function at `provider.ts:1536` reads `size_bytes` from the API response, but the fit report (`/api/fit`) also contains `model_mb` which could be used as a fallback. Additionally, the `mergeDiscoveredModel` function at `provider.ts:1460` preserves `sizeBytes` correctly, but the initial discovery may not be getting the data.

## What Changes

### Auto mode

- Replace `--dangerously-skip-permissions` with `--auto` flag (and `--permission-mode auto`)
- Create an `AutoMode` service that evaluates tool calls against safety rules
- Safe actions (file reads, local edits in working directory) auto-approve
- Risky actions (shell commands, network calls, destructive operations) route through a classifier-like evaluation
- Add permission mode cycling (`Shift+Tab` equivalent) in TUI
- Support `defaultMode: "auto"` in settings
- Classifier rules: block downloads+execution, sensitive data exfiltration, production deploys, mass deletions, IAM changes, force push, etc.
- Allow explicit `ask` rules to still force prompts even in auto mode

### /btw command

- Create a `/btw` slash command for temporary side questions
- Side questions have full visibility into current conversation context
- No tool access — answers only from existing context
- Single response in a dismissible overlay
- Does not add to conversation history
- Can run while agent is processing (independent of main turn)
- Reuses parent conversation's prompt cache for low cost

### Model size display fix

- Ensure `size_bytes` from `/v1/models` is properly captured during discovery
- Add fallback: use `model_mb` from `/api/fit` report when `size_bytes` is unavailable
- Display size in GB format in model picker and `opencode models` output
- Fix the data flow: `/v1/models` → `discoverOpenAICompatibleModels` → `sizeBytes` field → model picker UI

## Capabilities

### New Capabilities

- `auto-mode`: classifier-based permission mode that auto-approves safe actions while routing risky ones through safety evaluation
- `side-questions`: temporary /btw command for asking questions without adding to conversation history

### Modified Capabilities

- `permissions`: enhanced with mode system (default, acceptEdits, auto, dontAsk, bypassPermissions)
- `model-picker`: now displays model size in GB for local models

## Non-Goals

- Not implementing a full ML-based classifier (that's a server-side concern)
- Not changing the loop engine's core behavior
- Not adding persistent storage for side questions
- Not implementing Claude Code's full permission mode cycle (Shift+Tab) in this change — just the `--auto` flag and settings support

## Impact

- Modified: `packages/opencode/src/cli/cmd/run.ts` (replace --dangerously-skip-permissions with --auto)
- Modified: `packages/opencode/src/permission/index.ts` (add mode evaluation)
- Modified: `packages/opencode/src/session/tools.ts` (route through auto mode)
- New: `packages/opencode/src/cli/cmd/btw.ts` (/btw command implementation)
- New: `packages/opencode/src/auto-mode/` (auto mode service and rules)
- Modified: `packages/opencode/src/provider/provider.ts` (model size fallback from fit report)
- Modified: `packages/opencode/src/cli/cmd/models.ts` (display size in output)
- Modified: `packages/opencode/src/config/config.ts` (add auto mode config)
