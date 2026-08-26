---
"@opencode-ai/core": patch
---

Improve experimental shell scanning while preserving existing permission and
directory behavior. Cases not yet covered by the portable scanner fall back to
Tree-sitter, and scanning work is bounded for deeply nested input.
