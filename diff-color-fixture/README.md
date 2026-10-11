# Temporary diff color review

Local-only visual fixture. Not imported by product code. Do not format these files.

After the baseline commit, leave all example edits uncommitted.

- `01-inline.tsx`: adjacent rows, inline spans, one character, syntax, whitespace, long line.
- `02-folded.ts`: isolated hunks and multiple collapsed unchanged sections.
- `03-prose.md`: plain prose, punctuation, spaces, file boundaries, long prose.
- `04-many-rows.ts`: larger dense changed region.
- `05-deleted.txt` / `06-added.txt`: whole-file deletion / addition.

Open this worktree in OpenCode, open Review, select Uncommitted changes, and choose a file.
Compare the default OpenCode theme in Light and Dark with Unified and Split layouts.
Use a 1440 × 1000 viewport for comparisons and 800 × 1000 for the narrow case.
