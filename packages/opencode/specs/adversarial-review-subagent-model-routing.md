# Adversarial Review Subagent Model Routing Spec

## Goal

Document the OpenCode behavior that adversarial-review depends on:

- a plugin can reroute a new user turn to a specific model through `chat.message`
- subagents launched from the assistant generated for that turn should inherit that effective model by default
- the system should support strict turn boundaries between rounds so the next round's subagents start on the intended model

## Behavioral Contract

### 1. Message-level model routing

OpenCode resolves a prompt model before creating the user message, then triggers `chat.message` before saving that message.

- `chat.message` is triggered before the user message is persisted (`prompt.ts:1307-1320`)
- plugins can mutate `output.message.model`
- the saved user message model becomes the authoritative model for subsequent processing

### 2. Assistant model derivation

The session loop reads the latest user message model and resolves the provider model from it before LLM execution.

If a plugin changes the user message model in `chat.message`, the parent assistant for that turn runs on the routed model.

### 3. Subagent inheritance

When the `task` tool launches a subagent (`task.ts:108-111`), it computes the subagent model as:

- `agent.model` if the subagent agent explicitly defines one
- otherwise the parent assistant's `providerID` and `modelID`

That means a subagent inherits the effective model of the parent assistant by default.

## Precedence Rules

1. Explicit `agent.model` pin always wins (subagent or parent)
2. Plugin mutation via `chat.message` applies to the user message
3. Assistant uses the user message model by default
4. Subagent inherits parent assistant model by default

## Test Cases

| #   | Description                                 | Setup                                     | Expected                                |
| --- | ------------------------------------------- | ----------------------------------------- | --------------------------------------- |
| 1   | `chat.message` rewrites model               | plugin rewrites `output.message.model`    | user message persists with B            |
| 2   | cross-provider rewrite                      | plugin rewrites to different provider     | user message persists with new provider |
| 3   | parent assistant runs on rewritten model    | continue same prompt                      | assistant message uses routed model     |
| 4   | task subagent inherits routed model         | parent rerouted, assistant invokes `task` | subagent session uses parent model      |
| 5   | pinned subagent agent overrides inheritance | subagent agent pinned to C                | subagent runs as C, not B               |

## Acceptance Criteria

- [x] Regression tests prove:
  - [x] routed user model persists
  - [x] parent assistant uses routed model
  - [x] default subagents inherit routed model
  - [x] explicit pins still win
- [x] `bun typecheck` passes in `packages/opencode`
- [x] relevant tests pass in `packages/opencode`

## Non-Goals

This spec does **not** propose:

- a new core plugin hook for model switching
- forced mid-turn model replacement
- auto-updating the UI/TUI selected model
- changing subagent behavior when `agent.model` is explicitly set

## Important Constraint

This inheritance only helps if the next round begins from a fresh top-level turn.

If a workflow expects model changes to take effect mid-turn, after an assistant already started running, `chat.message` is too late because no new user message exists yet.

This is why adversarial-review must be structured so that each next round starts from a new top-level prompt.

## Key Files

- `packages/plugin/src/index.ts` — hook documentation
- `packages/opencode/src/tool/task.ts` — subagent inheritance logic (line ~108)
- `packages/opencode/src/session/prompt.ts` — model resolution and persistence (lines ~966–1320)
- `packages/opencode/test/session/chat-message-model-routing.test.ts` — regression tests
