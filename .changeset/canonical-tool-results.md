---
"@opencode-ai/plugin": minor
"@opencode-ai/sdk": minor
"@opencode-ai/client": minor
"@opencode-ai/protocol": minor
---

Replace the V2 tool result model with one canonical representation per fact. Tool declarations lose `structured`, `toStructuredOutput`, the `Structured` generic, and the exported `Tool.settle` interpreter; `toModelOutput` now receives the typed domain output and returns text or non-empty rich content, and the new optional `toMetadata` produces compact JSON UI metadata. Code Mode receives the validated encoded output. Durable tool success stores non-empty model content plus optional metadata; failure stores one error plus the final bounded partial snapshot. Progress and hook payloads use the `metadata`/`content` vocabulary, and `execute.after` hooks receive the canonical status union while keeping `outputPaths`. A one-time migration rewrites existing projected tool rows and moves provider-hosted result payloads into provider-owned result state.
