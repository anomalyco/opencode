---
"@opencode-ai/core": patch
"@opencode-ai/app": patch
---

Keep project labels stable when opening multiple clones of the same repository, while still refreshing the canonical path when its directory is renamed or removed.

Worktree setup scripts receive the selected source directory as `OPENCODE_WORKTREE_BASE` rather than another clone's shared project path.
