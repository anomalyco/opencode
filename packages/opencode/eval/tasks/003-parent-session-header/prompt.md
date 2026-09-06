The LLM request preparation code has a bug. When sending requests for opencode providers, the `x-parent-session-id` header is only included inside the session affinity/ID header block, which means it gets scoped to a condition. It should be sent unconditionally (when a parent session ID exists) regardless of whether session affinity headers are being set.

Fix `packages/opencode/src/session/llm/request.ts` so that the `x-parent-session-id` header is spread at the top level of the headers object, outside of the conditional block that sets session affinity headers.

Write a test that verifies the `x-parent-session-id` header is sent for opencode providers when a parent session ID is provided.


