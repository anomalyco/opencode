---
description: Run simplicio-mapper to refresh .specs/, agent dirs and docs/*-map.md (mandatory before programming)
---

Run the project mapper. This MUST run before any programming task — it produces the structured context every Simplicio tool consumes.

Steps:

1. Execute `script/simplicio/flow.sh --map-only` (equivalent to `npx -y @wesleysimplicio/llm-project-mapper@latest --yes --no-update-check --cli skip --append-gitignore no --skip-meta`).
2. Confirm `.specs/`, `.agents/`, `.codex/`, `.skills/`, `docs/architecture-map.md` and `docs/domain-map.md` were generated or updated.
3. Surface a one-line summary: number of files mapped, top-level packages detected, and any warnings the mapper emitted.

Note: the mapper has **no subcommand** — invoking the binary IS the map. The flow script enforces safe flags so it never appends to `.gitignore` or hands off to an external CLI.

If `npx` or Node is missing, report the missing dependency and stop — do not attempt a manual mapping.
