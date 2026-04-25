# OpenCode Windows/Core Bug Triage

Source query: https://github.com/anomalyco/opencode/issues?q=state%3Aopen%20label%3Abug%20label%3Acore%20label%3Awindows

Snapshot: 2026-04-25

Total open issues in query: 171

Policy: one branch per fixable issue, no PR opened before review.

## Current Work

| Issue  | Status                         | Branch                                     | Existing open PR                                                     | Notes                                                                                       |
| ------ | ------------------------------ | ------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| #22054 | Fixed locally, awaiting review | `fix/22054-windows-bash-detection`         | None found                                                           | Bash detection on Windows did not support Bash from `PATH` or MSYS2 UCRT64 git layout.      |
| #23048 | Fixed locally, awaiting review | `fix/23048-read-permission-relative-path`  | None directly found; later review found related #18761               | `read` permissions used absolute paths, so exact project-relative deny rules did not match. |
| #21444 | Fixed locally, awaiting review | `fix/21444-file-list-junction-directories` | None directly found; related #18291 covers search index, not UI list | File tree classified junction/symlink directories as files.                                 |

## Reviewed Issues

### #21444 - Windows Junction (symbolic link) directories not showing in file tree

URL: https://github.com/anomalyco/opencode/issues/21444

Labels: `bug`, `windows`, `core`

State: Open

Author: MitPeng

Reviewed: 2026-04-25

Status: Fixed locally, awaiting review

Branch: `fix/21444-file-list-junction-directories`

Open PR check:

| Query                                                                         | Result                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `gh search prs --repo anomalyco/opencode "21444" --state open`                | none                                                                            |
| `gh search prs --repo anomalyco/opencode "junction" "file tree" --state open` | none                                                                            |
| `gh search prs --repo anomalyco/opencode "symlink" "file tree" --state open`  | none                                                                            |
| `gh search prs --repo anomalyco/opencode "18182" --state open`                | #18291, related to file search/autocomplete indexing, not `File.list()` UI tree |

Discussion summary:

| Commenter      | Summary                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MitPeng        | Reported Windows junction directories (`mklink /J`, shown as `d----l`) are accessible through glob but not visible as directories in the UI file tree. |
| github-actions | Suggested possible duplicates #18963 and #18182 around symlink/junction display and indexing.                                                          |

Fix summary:

| File                                        | Change                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/file/index.ts`       | `File.list()` follows symlink/junction metadata with `stat()` and classifies symlink targets that are directories as `directory` nodes. |
| `packages/opencode/test/file/index.test.ts` | Added regression coverage for linked directories in `File.list()`.                                                                      |

Verification:

| Command                                                     | Result          |
| ----------------------------------------------------------- | --------------- |
| `bun test test/file/index.test.ts` from `packages/opencode` | Pass, 53 tests. |
| `bun typecheck` from `packages/opencode`                    | Pass.           |

### #23636 - fix: PowerShell output encoding for non-ASCII characters on Windows

URL: https://github.com/anomalyco/opencode/issues/23636

Status: Skipped, existing PR open

Existing PR: #23635 `fix:PowerShell encoding for non-ASCII characters on Windows`

Notes: Issue discussion includes a complete `bash.ts` diff and maintainer interest, but #23635 already closes #23636 and changes `packages/opencode/src/tool/bash.ts`.

### #23519 - Permission rules not enforced for "edit" operation performed by Task subagents

URL: https://github.com/anomalyco/opencode/issues/23519

Status: Skipped, existing related PR open

Existing PR: #18761 `fix(opencode): Use standard resolve function to get proper filePaths for tools`

Notes: A maintainer comment points to #18761 as the fix. The thread also identified the read/edit relative-vs-absolute mismatch that overlaps with #23048.

### #21607 - Log rotation on Windows incorrectly deletes the most recent log file

URL: https://github.com/anomalyco/opencode/issues/21607

Status: Skipped, already covered in current code / related PR

Existing related PR: #16628 touches `packages/opencode/src/util/log.ts` and states it fixes log cleanup ordering.

Notes: Current `dev` already sorts timestamped log filenames before deleting old entries and has `test/util/log.test.ts` coverage for keeping newest timestamped logs.

### #15023 - session-list shows empty when --project-path equals current directory

URL: https://github.com/anomalyco/opencode/issues/15023

Status: Skipped, multiple existing related PRs open

Existing related PRs: #20215, #23862, #20216, #20361, #23276 among others from `session-list project-path` search.

Notes: The issue points to Windows path-sensitive session matching. There are already several open PRs normalizing Windows path separators/session queries.

### #23457 - Expand-Archive error on Windows PowerShell when loading skills in v1.14.18

URL: https://github.com/anomalyco/opencode/issues/23457

Status: Already fixed in current `dev`; no branch opened

Open PR check:

| Query                                                                             | Result |
| --------------------------------------------------------------------------------- | ------ |
| `gh search prs --repo anomalyco/opencode "23457" --state open`                    | none   |
| `gh search prs --repo anomalyco/opencode "Expand-Archive" "ripgrep" --state open` | none   |

Notes: Current `packages/opencode/src/file/ripgrep.ts` already inlines escaped archive and destination paths in the `Expand-Archive` command instead of using `$args`.

### #23048 - Windows: permission.read exact path rules fail with / and require \ to match

URL: https://github.com/anomalyco/opencode/issues/23048

Status: Fixed locally, awaiting review

Branch: `fix/23048-read-permission-relative-path`

Open PR check:

| Query                                                          | Result |
| -------------------------------------------------------------- | ------ |
| `gh search prs --repo anomalyco/opencode "23048" --state open` | none   |

Notes: Later review of #23519 found #18761 is related and may overlap by standardizing file path matching across tools.

Fix summary:

| File                                       | Change                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/tool/read.ts`       | Uses project-relative path for `read` permission checks when the target is inside the worktree, matching `edit` and `write`; external paths still use absolute paths. |
| `packages/opencode/test/tool/read.test.ts` | Added regression coverage for exact project-relative `read` deny rules.                                                                                               |

Verification:

| Command                                                    | Result          |
| ---------------------------------------------------------- | --------------- |
| `bun test test/tool/read.test.ts` from `packages/opencode` | Pass, 38 tests. |
| `bun typecheck` from `packages/opencode`                   | Pass.           |

### #22054 - Insufficient Bash detection on Win32

URL: https://github.com/anomalyco/opencode/issues/22054

Status: Fixed locally, awaiting review

Branch: `fix/22054-windows-bash-detection`

Open PR check:

| Query                                                                                         | Result |
| --------------------------------------------------------------------------------------------- | ------ |
| `gh search prs --repo anomalyco/opencode "22054" --state open`                                | none   |
| `gh search prs --repo anomalyco/opencode "Insufficient Bash detection on Win32" --state open` | none   |
| `gh search prs --repo anomalyco/opencode "bash detection" "windows" --state open`             | none   |

Fix summary:

| File                                         | Change                                                                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/shell/shell.ts`       | `Shell.gitbash()` scans `PATH` for a valid `bash.exe`, skips WSL `System32`/`Sysnative` Bash and inaccessible entries, then falls back through Git for Windows and MSYS2 layouts. |
| `packages/opencode/test/shell/shell.test.ts` | Added Windows tests for PATH Bash priority, MSYS2 UCRT64 git layout, and WSL Bash exclusion.                                                                                      |

Verification:

| Command                                                      | Result          |
| ------------------------------------------------------------ | --------------- |
| `bun test test/shell/shell.test.ts` from `packages/opencode` | Pass, 10 tests. |
| `bun typecheck` from `packages/opencode`                     | Pass.           |

## Reviewed But Not Fixed Yet

| Issue  | Status                                 | Notes                                                                                                                                                                       |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #20527 | Needs broader prompt/shell UX decision | No open PR found. Current prompt already exposes `OS` and `Shell` and warns against `tail`; likely needs a more deliberate PowerShell-specific prompt/tool rename refactor. |
| #20961 | Needs reproduction                     | No open PR found. Current `/init` template replaces `${path}` with `ctx.worktree`; reported `/<system-reminder>` prompt corruption was not obvious from current code.       |
| #20085 | Needs TUI/input reproduction           | Duplicate bot points to #19746; no code path selected yet.                                                                                                                  |
| #23942 | Needs reproduction / likely duplicate  | Sparse `uv_spawn` report; bot points to #22586 and #21198.                                                                                                                  |
| #23907 | Needs permission model decision        | Discussion questions deterministic enforcement for shell execution; not enough to safely patch from report alone.                                                           |

## Pending

Not yet reviewed in detail: 158 issues from the source query.
