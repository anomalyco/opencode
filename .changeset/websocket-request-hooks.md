---
"@opencode-ai/plugin": patch
"@opencode-ai/core": patch
---

Add transport-neutral Session model request hooks and provider-scoped hook registration so eligible OpenAI Responses requests can prefer WebSocket without bypassing HTTP-only middleware.
