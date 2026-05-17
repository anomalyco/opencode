---
name: check
description: "Validates recently written code against project-specific development guidelines from .trellis/spec/. Identifies changed files via git diff, discovers applicable spec modules, runs lint and typecheck, and reports guideline violations. Use when code is written and needs quality verification, to catch context drift during long sessions, or before committing changes."
---

Check if the code you just wrote follows the development guidelines.

Execute these steps:

1. **Identify changed files**:
   ```bash
   git diff --name-only HEAD
   ```

2. **Determine which spec modules apply** based on the changed file paths:
   ```bash
   python3 ./.trellis/scripts/get_context.py --mode packages
   ```

3. **Read the spec index** for each relevant module:
   ```bash
   cat .trellis/spec/<package>/<layer>/index.md
   ```
   Follow the **"Quality Check"** section in the index.

4. **Read the specific guideline files** referenced in the Quality Check section (e.g., `quality-guidelines.md`, `conventions.md`). The index is NOT the goal — it points you to the actual guideline files. Read those files and review your code against them.

5. **Run lint and typecheck** for the affected package.

6. **Report any violations** and fix them if found.
