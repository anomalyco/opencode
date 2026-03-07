---
description: Import a mystery book and initialize chapter index
---

Use the `mystery-command-workflow` skill guidance.

Execute `/import` with the given path.

Arguments:
- `$ARGUMENTS` is the source path.

Behavior:
- Validate the path is present.
- Import the source into deterministic local storage.
- Return the detected chapter count and generated book id.
