---
"@opencode-ai/core": patch
---

Wake idle sessions when recovering background shell outcomes after a server restart. Admit shell outcomes before resuming background child sessions, while preserving restart retry budgets and completion-driven parent notifications.
