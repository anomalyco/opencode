---
"@opencode-ai/core": patch
---

Make the experimental portable shell scanner authoritative, with no Tree-sitter
fallback. Scan common Bash and PowerShell control flow, heredocs, functions,
expressions, quoting, and substitutions natively. Preserve existing redirect and
declaration permission matching, and make PowerShell saved approvals cover the
original command spelling. Parser failures remain visible without changing the
permission engine. The default Tree-sitter path is unchanged.
