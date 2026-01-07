# Reasoning-Only Response Fallback

## Problem
OpenCode sometimes receives assistant responses that contain only reasoning blocks or tool calls without any visible text. The TUI filters out reasoning-only/tool-only content, so the user sees no final answer in the console.

## Goal
Ensure every assistant response yields a user-facing text reply whenever possible, without breaking the existing session flow.

## Approach (Implemented)
- Detect assistant messages that finished successfully but have **no visible text parts** and contain **reasoning or tool parts**.
- Before the loop exits, enqueue a synthetic user message that asks for a final response.
- Route that message through a hidden `final` agent with tools disabled.
- Mark the synthetic fallback message so it is not re-triggered.
- Log a warning when the fallback triggers for observability.

## Architecture Notes
- Fallback detection lives in `SessionPrompt.loop` and uses `MessageV2` parts to determine if text is visible.
- A synthetic user message is inserted via `Session.updateMessage`/`Session.updatePart` to reuse the normal processing path.
- The `final` agent has a focused prompt and deny-all permissions.
- Per-message tool overrides support `{"*": false}` to disable all tools for the fallback.

## Key Code Paths
- `packages/opencode/src/session/prompt.ts`
  - Detect reasoning/tool-only assistant responses.
  - Enqueue synthetic fallback user message with metadata marker.
  - Apply per-message tool overrides including wildcard disable.
- `packages/opencode/src/agent/agent.ts`
  - Add hidden `final` agent.
- `packages/opencode/src/agent/prompt/final.txt`
  - Prompt that enforces a final text response with no tool calls.
- `packages/opencode/src/session/llm.ts`
  - Support `user.tools["*"] === false` to disable tools at the stream layer.

## Guardrails
- The fallback message is marked with metadata (`finalFallback`) to avoid repeated fallback loops.
- If the fallback agent still returns reasoning-only, the loop exits normally to avoid infinite retries.

## Suggested Tests
- Reasoning-only response triggers fallback and produces visible text.
- Tool-only response triggers fallback and produces visible text.
- Fallback message is not re-triggered.
- Normal text response does not trigger fallback.
