---
"@opencode-ai/core": patch
---

Simplify interrupt continuation: the steer-scoped resume decision now lives in SessionExecution as a post-cleanup inbox check, and the run coordinator drops its continuation state machine. Wakes arriving during cancellation cleanup now restart a normal full drain, and interrupting an idle session with continue now resumes pending steering input.
