# Pattern: Workspace Split Parity Merge

## Trigger

A single logical workspace is split across two local roots and must be consolidated without data loss.

## Mandatory Sequence

1. Pick source A baseline and source B overlay.
2. Exclude VCS internals (`.git`) from merge copy path.
3. Copy all source A files into destination.
4. Overlay source B files:
   - if path absent -> copy,
   - if identical -> skip,
   - if text conflict -> synthesize both variants in one parity file,
   - if binary conflict -> preserve source sidecars.
5. Emit machine + human evidence (`MERGE_PARITY_REPORT.json`, `MERGE_PARITY_NOTES.md`).
6. Generate governance index for operator cleanup confidence.
7. Update continuity checkpoint and decision/journal/knowledge write-back.

## Closure Rule

Do not authorize source-root deletion until merged workspace and parity artifacts are inspected and accepted by Nexus/Pyxis.
