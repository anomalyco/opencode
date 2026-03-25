---
description: Continue interrupted work and investigate what caused the interruption
---

Determine the current piece of work that was interrupted, continue it, and investigate what caused the interruption.

This includes:

- Identify the intended in-progress task from the current branch, diff against `dev`, and nearby touched files
- Resume the work in the most likely place it stopped instead of starting a new, unrelated change
- Investigate why it was interrupted, such as a stalled session, failing test or typecheck, partial implementation, or another blocking issue
- Fix the underlying issue when it is in scope and safe to do so
- Keep the result consistent with the surrounding code and existing conventions

Report at the end with only a 1-3 sentence summary of what you changed and the most likely cause of the interruption.

$ARGUMENTS
