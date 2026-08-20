---
"@opencode-ai/core": patch
---

Title generation and compaction summaries now build their model requests through the shared session request boundary. Both requests now run session context hooks and unsupported-media filtering, title requests gain the session prompt cache key, and compaction summaries in forked sessions reuse the fork root's prompt cache key instead of the fork's own.
