---
"@opencode-ai/core": patch
---

Keep Console model inventories available across restarts using a stored-connection cache, and recover transient fetch failures with scoped retries. Refresh and caching stay inside the Console plugin, preserve existing catalog policy, and do not persist resolved credentials.
