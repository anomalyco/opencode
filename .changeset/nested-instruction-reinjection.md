---
"@opencode-ai/core": patch
---

Nested AGENTS.md instructions are re-injected after compaction. Previously the in-memory dedup claim outlived the synthetic message that compaction dropped from model-visible history, so nested instructions were silently lost for the rest of the process lifetime. The claim now only guards in-flight loads; the synthetic message metadata in durable history is the sole lasting ledger, so any history truncation (compaction, revert) self-heals on the next read in that subtree.
