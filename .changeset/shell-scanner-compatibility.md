---
"@opencode-ai/core": patch
---

Make the experimental portable shell scanner authoritative, with no Tree-sitter
fallback. Preserve the existing permission policy, handle arithmetic expansions
natively, and report unsupported syntax as scanner errors. The default
Tree-sitter path is unchanged.
