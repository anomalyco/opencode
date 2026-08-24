# Tasks: repo-agent-personas

## Phase 1: Remove the broken bridge

- [x] 1.1 Delete the dangling symlinks in `.opencode/agent/` and drop their `.gitignore` entries
  - The ten links pointed at `/Users/andreas/dev/opencode/.skein/agents/`, gone since the rename
  - Validation: no entry under `.opencode/agent/` is a symlink; `git check-ignore` matches none of them
  - Done 2026-08-06. `.gitignore` now ignores only `.opencode/agent/_synth-*.md` — the
    supervisor-generated profiles skein writes — with a note recording why the rest went.

## Phase 2: Write the personas

- [x] 2.1 `coder.md` — implements one `tasks.md` slice
  - Effect-TS/Bun idiom, edit + write + bash allowed, webfetch/websearch denied
  - Told to keep to the named slice and to leave `tasks.md` checkboxes to the caller
- [x] 2.2 `tester.md` — writes and runs tests for a slice
  - `bash` allowed (this is load-bearing), knows `bun test <path> --timeout`, knows `OPENCODE_DISABLE_LOCAL_SYNC=1`
- [x] 2.3 `reviewer.md` — reads finished work, emits `LGTM` / `NEEDS_WORK`
  - `write` and `edit` denied; returns its verdict as its result, not as a file
- [x] 2.4 `researcher.md` — answers a question from the codebase, changes nothing
- [x] 2.5 `persona-auditor.md` — judges an agent definition against its stated description
  - `write`/`edit` denied so it cannot rewrite what it judges
  - Validation for 2.1–2.5: every file loads; `mode`, `description`, `permission` present
  - Done 2026-08-06. Adapted from skein's `templates/agents/`, rewritten for this stack —
    the originals target skein's Go codebase and write into `.skein/`, neither of which
    exists here.

## Phase 3: Run the audit

- [x] 3.1 Run `persona-auditor` over each persona in the set
  - Done 2026-08-06 via `opencode run --agent persona-auditor`. It verified the referenced
    paths and commands rather than assuming them (`testEffect`, `test/lib/effect.ts`,
    `test/fixture`, `openspec/changes/`, the three package roots).
- [x] 3.2 Fold the findings back into the persona files
  - One substantive finding: `researcher` had no prescribed output shape, rated "medium
    actionability — could lead to inconsistent answers". Given Answer / Evidence /
    Unresolved headings and told not to append plans it was not asked for.
  - One noted non-defect: the auditor's own check 5 (read sibling definitions) is a heavier
    instruction than the rest. Kept — overlap cannot be judged from one file.
- [x] 3.3 Record each verdict here — the change is not done until every persona is `LGTM`
  - `coder` LGTM · `tester` LGTM · `reviewer` LGTM · `researcher` LGTM (after 3.2) ·
    `persona-auditor` LGTM

## Phase 4: Verification

- [x] 4.1 Assert the set loads and the pinned permissions hold
  - `test/agent/repo-personas.test.ts`: no entry is a symlink; the five roles load as
    subagents with a description and prompt; reviewer/auditor/researcher deny write and
    edit; tester and coder allow bash; no persona sends an agent after Go sources or tells
    it to write into `.skein/` (the auditor is exempt — naming those antipatterns is its job)
  - Validation: 5/5 pass
- [x] 4.2 `bun run typecheck` clean
