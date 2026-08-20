---
"@opencode-ai/core": patch
---

Title generation and compaction summaries now build their model requests through the shared session request boundary, gaining unsupported-media filtering and image bounds while explicitly opting out of session context hooks: plugins that shape the agent conversation do not observe title or compaction requests. Title requests gain the fork-aware session prompt cache key, and compaction summaries in forked sessions reuse the fork root's prompt cache key instead of the fork's own.
