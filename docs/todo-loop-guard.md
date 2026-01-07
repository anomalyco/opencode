# Todo Loop Guard

## Problem
When a session has pending todos, the model can keep trying to continue them even when the user did not ask to resume. With strong TODO-focused system prompts and custom instructions, this can cause repeated “continue TODO” outputs and a perception of looping.

## Goals
- Prevent automatic continuation of old todos unless the user explicitly asks.
- Preserve the ability to use todos for new work.
- Keep behavior predictable and safe for UI and CLI.

## Approach
1. Track a lightweight per-session TODO state (`paused`, `updatedAt`, `lastUpdatedMessageID`).
2. When a new user message arrives:
   - If there are pending todos and the message is **not** a continuation request, mark the todo list as `paused`.
   - If the user explicitly asks to continue/resume, unpause.
3. When todos are paused and still pending, inject a short system-level guard:
   - Do **not** continue pending todos unless the user explicitly asks.
   - Ask a brief clarification if needed.
4. When `todowrite` updates the list, clear the paused flag.

## Continuation Detection
Treat as explicit continuation if user text contains:
- English: `continue`, `resume`, `proceed`, `keep going`, `next step`
- Russian: `продолж`, `дальше`, `продолжай`

## Files
- `packages/opencode/src/session/todo.ts`
  - Add state storage and helpers.
- `packages/opencode/src/tool/todo.ts`
  - Clear paused state on `todowrite`.
- `packages/opencode/src/session/prompt.ts`
  - Evaluate pending todos, continuation intent, and inject a pause guard.

## Notes
- No UI changes required. The guard is a server-side safety net.
- This does **not** auto-cancel todos; it only pauses continuation until explicit user intent.
