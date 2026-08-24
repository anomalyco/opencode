---
"@opencode-ai/core": patch
---

Restore `OPENCODE_DISABLE_CLAUDE_CODE` env var support: skip discovery of the global `~/.claude` and project `.claude` config sources when set. This re-enables the V1 compatibility behavior for suppressing Claude Code prompt and skill loading in V2.
