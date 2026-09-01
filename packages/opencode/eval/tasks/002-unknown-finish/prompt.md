The agent loop in the session prompt system has a bug. When the LLM returns an unknown finish reason (not "stop" or "tool-calls"), the loop incorrectly terminates instead of continuing. This means if a provider returns an unexpected finish reason, the agent stops prematurely.

Fix the issue in `packages/opencode/src/session/prompt.ts`. The condition that checks whether to continue the loop should treat "unknown" finish reasons the same way as "tool-calls" — i.e., the loop should continue rather than stop.

Write a test that verifies the loop continues when the finish reason is "unknown".


