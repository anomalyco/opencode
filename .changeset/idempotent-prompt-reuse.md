---
"@opencode-ai/core": patch
---

Prompt and synthetic inbox ID reuse is now idempotent: reusing an ID within the same Session succeeds and returns the first admission, ignoring the retried payload, metadata, and delivery mode. Previously reuse with a differing payload failed with a conflict. Cross-Session and cross-type reuse still fail, and control items keep their operation-specific conflict behavior.
