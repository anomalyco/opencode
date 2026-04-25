# OpenCode Windows/Core Bug Triage

Source query: https://github.com/anomalyco/opencode/issues?q=state%3Aopen%20label%3Abug%20label%3Acore%20label%3Awindows

Snapshot: 2026-04-25

Total open issues in query: 171

Policy: one branch per fixable issue, no PR opened before review.

## Current Work

| Issue  | Status                         | Branch                                    | Existing open PR | Notes                                                                                       |
| ------ | ------------------------------ | ----------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| #22054 | Fixed locally, awaiting review | `fix/22054-windows-bash-detection`        | None found       | Bash detection on Windows did not support Bash from `PATH` or MSYS2 UCRT64 git layout.      |
| #23048 | Fixed locally, awaiting review | `fix/23048-read-permission-relative-path` | None found       | `read` permissions used absolute paths, so exact project-relative deny rules did not match. |

## Reviewed Issues

### #23048 - Windows: permission.read exact path rules fail with / and require \ to match

URL: https://github.com/anomalyco/opencode/issues/23048

Labels: `bug`, `windows`, `core`

State: Open

Author: deokju

Reviewed: 2026-04-25

Status: Fixed locally, awaiting review

Branch: `fix/23048-read-permission-relative-path`

Open PR check:

| Query                                                          | Result |
| -------------------------------------------------------------- | ------ |
| `gh search prs --repo anomalyco/opencode "23048" --state open` | none   |

Discussion summary:

| Commenter | Summary                                                                                                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deokju    | Reported that a project `permission.read` rule with exact relative path like `src/main/.../ExampleController.java` is visible in config but does not deny reads on Windows, while wildcard `*ExampleController.java` works. No comments on the issue. |

Fix summary:

| File                                       | Change                                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/tool/read.ts`       | Uses the project-relative path for `read` permission checks when the target is inside the worktree, matching `edit` and `write` behavior; external paths still use absolute paths. |
| `packages/opencode/test/tool/read.test.ts` | Added regression coverage for exact project-relative `read` deny rules and tightened the Windows Git Bash path normalization fixture.                                              |

Verification:

| Command                                                    | Result          |
| ---------------------------------------------------------- | --------------- |
| `bun test test/tool/read.test.ts` from `packages/opencode` | Pass, 38 tests. |
| `bun typecheck` from `packages/opencode`                   | Pass.           |

### #23457 - Expand-Archive error on Windows PowerShell when loading skills in v1.14.18

URL: https://github.com/anomalyco/opencode/issues/23457

Labels: `bug`, `windows`, `core`

State: Open

Author: dylanhaskins

Reviewed: 2026-04-25

Status: Already fixed in current `dev`; no branch opened

Open PR check:

| Query                                                                             | Result |
| --------------------------------------------------------------------------------- | ------ |
| `gh search prs --repo anomalyco/opencode "23457" --state open`                    | none   |
| `gh search prs --repo anomalyco/opencode "Expand-Archive" "ripgrep" --state open` | none   |

Discussion summary:

| Commenter    | Summary                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dylanhaskins | Reported PowerShell `Expand-Archive` receives null `$args[0]` when auto-downloading ripgrep for skills/grep. Workaround is installing ripgrep manually. |
| kagura-agent | Identified `$args` population under Windows PowerShell 5.x as the likely root cause and suggested inlining escaped paths into the PowerShell command.   |
| asertym      | Confirmed the issue persisted in v1.14.18 and v1.14.19.                                                                                                 |
| Hona         | Asked for confirmation and logs.                                                                                                                        |

Code check:

| File                                    | Observation                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/file/ripgrep.ts` | Current `dev` already inlines escaped archive and destination paths in the `Expand-Archive` command instead of using `$args`. |

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

## Pending

Not yet reviewed in detail: 168 issues from the source query.
