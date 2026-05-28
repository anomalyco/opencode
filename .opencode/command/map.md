---
description: Run simplicio-mapper to refresh .simplicio/project-map.json (mandatory before programming)
---

Run the project mapper. This MUST run before any programming task — it produces the structured context every Simplicio tool consumes.

Steps:

1. Execute `script/simplicio/flow.sh --map-only` (or `npx -y @wesleysimplicio/llm-project-mapper@latest map --yes` if the script is missing).
2. Confirm `.simplicio/project-map.json` was updated.
3. Surface a one-line summary: number of files mapped, top-level packages detected, and any warnings the mapper emitted.

If `npx` or Node is missing, report the missing dependency and stop — do not attempt a manual mapping.
