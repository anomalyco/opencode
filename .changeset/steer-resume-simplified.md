---
"@opencode-ai/core": patch
---

Simplify interrupt continuation: the steer-scoped resume decision now lives in SessionExecution as a post-cleanup inbox check, and the run coordinator drops its continuation state machine. Wakes arriving during cancellation cleanup now restart a normal full drain, and interrupting an idle session with continue now resumes pending steering input. Recovery-applied moves now end with the same full wake as inbox-admitted moves, retrying any stranded inbox work at the new location. Interrupting with continue now also resumes a next-in-line control item: between-turn manual compaction and moves run under any drain scope, while queued prompts remain parked.
