---
"@opencode-ai/plugin": minor
"@opencode-ai/sdk": minor
"@opencode-ai/client": minor
"@opencode-ai/protocol": minor
---

Replace the V2 tool result model with one canonical representation per fact. Tools lose `structured`, projection callbacks, the `Structured` generic, and the exported `Tool.settle` interpreter; tool responses carry schema-validated `output`, model-visible `content`, and optional compact JSON `metadata`. Code Mode receives the validated encoded output. Durable tool success stores non-empty model content plus optional metadata; failure stores one error plus the final bounded partial snapshot. Progress carries metadata only, while `execute.after` hooks receive the canonical terminal outcome and managed `outputPaths`. A one-time migration rewrites existing projected tool rows and moves provider-hosted result payloads into provider-owned result state.
