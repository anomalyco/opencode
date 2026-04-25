# OpenCode Windows/Core Bug Triage

Source query: https://github.com/anomalyco/opencode/issues?q=state%3Aopen%20label%3Abug%20label%3Acore%20label%3Awindows

Snapshot: 2026-04-25

Total open issues in query: 171

Policy: one branch per fixable issue, no PR opened before review.

## Current Work

| Issue  | Status                         | Branch                             | Existing open PR | Notes                                                                                  |
| ------ | ------------------------------ | ---------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| #22054 | Fixed locally, awaiting review | `fix/22054-windows-bash-detection` | None found       | Bash detection on Windows did not support Bash from `PATH` or MSYS2 UCRT64 git layout. |

## Reviewed Issues

### #22054 - Insufficient Bash detection on Win32

URL: https://github.com/anomalyco/opencode/issues/22054

Labels: `bug`, `windows`, `core`

State: Open

Author: FrankHB

Reviewed: 2026-04-25

Status: Fixed locally, awaiting review

Branch: `fix/22054-windows-bash-detection`

Open PR check:

| Query                                                                                         | Result |
| --------------------------------------------------------------------------------------------- | ------ |
| `gh search prs --repo anomalyco/opencode "22054" --state open`                                | none   |
| `gh search prs --repo anomalyco/opencode "Insufficient Bash detection on Win32" --state open` | none   |
| `gh search prs --repo anomalyco/opencode "bash detection" "windows" --state open`             | none   |

Discussion summary:

| Commenter      | Summary                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| github-actions | Suggested possible duplicates: #10871 and #19413, both related to Windows Bash path detection.                                                                                   |
| FrankHB        | Clarified this is distinct because Bash can be installed independently of Git, especially through MSYS2 native Win32 packages. Current code assumes Git for Windows layout only. |
| Hona           | Asked how to find Bash when it is not in `PATH`; agreed other Bash executables should be supported.                                                                              |

Fix summary:

| File                                         | Change                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/shell/shell.ts`       | `Shell.gitbash()` now scans `PATH` for a valid `bash.exe`, skips the WSL `System32`/`Sysnative` Bash launcher and inaccessible PATH entries, then falls back through Git for Windows and MSYS2 layouts. |
| `packages/opencode/test/shell/shell.test.ts` | Added Windows tests for PATH Bash priority, MSYS2 UCRT64 git layout, and WSL Bash exclusion.                                                                                                            |

Verification:

| Command                                                      | Result                                |
| ------------------------------------------------------------ | ------------------------------------- |
| `bun install --frozen-lockfile`                              | Pass, dependencies installed locally. |
| `bun test test/shell/shell.test.ts` from `packages/opencode` | Pass, 10 tests.                       |
| `bun typecheck` from `packages/opencode`                     | Pass.                                 |

Next action: wait for review or explicit permission to commit/stash before moving to another issue branch.

## Pending

Not yet reviewed in detail: 170 issues from the source query.
