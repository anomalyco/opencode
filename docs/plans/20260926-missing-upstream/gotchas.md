# Gotchas — 20260926-missing-upstream (local, 2026-09-26)

- [2026-09-26] Gray area: stale refs invalidate the missing set — `git fetch` `origin/dev` + `git fetch --tags` before diffing; a stale `origin/dev` or stale `v2.0.16` tag yields a wrong missing list. Re-resolve refs at assessment time.
- [2026-09-26] Gray area: tag lag — `v2`/tags may lag `origin/dev`; a commit present on `origin/dev` but absent from the `v2.0.16` tag is still missing for v2.0.16-scope purposes. Do not treat tag-absent as dev-absent; record both per `patterns.md` ref priority.
- [2026-09-26] Guard: do NOT expand scope beyond series/v2.0.16 without an explicit decision — tip-ahead commits on `origin/dev` past v2.0.16 are out of scope until the pin moves.
- [2026-09-26] Guard: do NOT implement backports in this task — docs/memory only. No cherry-pick, no rebase, no code edit; compat calls in `fixes.md` are inventory, not applied changes.
- [2026-09-26] AGENTS.md not touched (deliberate): v2.0.16 pin, series scope, and `origin/dev`-primary ref rule are local triage memory, not global agent conventions. Promote only if a reusable convention emerges.
