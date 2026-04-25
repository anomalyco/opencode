# OpenCode Windows/Core Bug Triage

Source query: https://github.com/anomalyco/opencode/issues?q=state%3Aopen%20label%3Abug%20label%3Acore%20label%3Awindows

Snapshot: 2026-04-25

Total open issues in query: 171

Policy: one branch per fixable issue, no PR opened before review.

## Current Work

| Issue  | Status    | Branch                                     | Existing open PR                           | Notes                                                                                  |
| ------ | --------- | ------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| #22054 | PR opened | `fix/22054-windows-bash-detection`         | #24321                                     | Bash detection did not support Bash from `PATH` or MSYS2 UCRT64 git layout.            |
| #23048 | PR opened | `fix/23048-read-permission-relative-path`  | #24320; related #18761 found later         | Exact project-relative `permission.read` deny rules did not match absolute read paths. |
| #21444 | PR opened | `fix/21444-file-list-junction-directories` | #24319; related #18291 covers search index | File tree classified junction/symlink directories as files.                            |
| #15386 | PR opened | `fix/15386-permission-reply-not-found`     | #24322                                     | Permission replies to stale IDs returned success instead of 404.                       |

## Fixed Locally

### #15386 - `POST /permission/{requestID}/reply` returns 200/true for non-existent permission IDs

URL: https://github.com/anomalyco/opencode/issues/15386

Status: PR opened

Branch: `fix/15386-permission-reply-not-found`

PR: https://github.com/anomalyco/opencode/pull/24322

Open PR check:

| Query                                                                           | Result |
| ------------------------------------------------------------------------------- | ------ |
| `gh search prs --repo anomalyco/opencode "15386" --state open`                  | none   |
| `gh search prs --repo anomalyco/opencode "permission reply" "404" --state open` | none   |

Discussion summary:

| Commenter            | Summary                                                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vishal-android-freak | Reported pending permissions are lost after server restart and replying to the old permission ID returns 200/true even though no pending permission exists. Asked for either persistence or a 404 so clients can re-prompt. |

Fix summary:

| File                                                                 | Change                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/opencode/src/permission/index.ts`                          | `Permission.reply()` now fails with `NotFoundError` when `requestID` is not pending. |
| `packages/opencode/src/server/routes/instance/httpapi/permission.ts` | Experimental HttpApi maps stale permission replies to `HttpApiError.NotFound`.       |
| `packages/opencode/test/permission/next.test.ts`                     | Updated regression test to require `NotFoundError` for unknown permission IDs.       |

Verification:

| Command                                                          | Result          |
| ---------------------------------------------------------------- | --------------- |
| `bun test test/permission/next.test.ts` from `packages/opencode` | Pass, 79 tests. |
| `bun typecheck` from `packages/opencode`                         | Pass.           |

### #21444 - Windows Junction directories not showing in file tree

URL: https://github.com/anomalyco/opencode/issues/21444

Status: PR opened

Branch: `fix/21444-file-list-junction-directories`

PR: https://github.com/anomalyco/opencode/pull/24319

Open PR check: no direct #21444 PR; #18291 is related to file search/autocomplete indexing, not `File.list()` UI tree.

Fix summary: `File.list()` follows symlink/junction metadata with `stat()` and classifies linked directory targets as `directory`; regression test added in `test/file/index.test.ts`.

Verification: `bun test test/file/index.test.ts` pass, `bun typecheck` pass.

### #23048 - Windows permission.read exact path rules fail with `/`

URL: https://github.com/anomalyco/opencode/issues/23048

Status: PR opened

Branch: `fix/23048-read-permission-relative-path`

PR: https://github.com/anomalyco/opencode/pull/24320

Open PR check: no direct #23048 PR; later review found related #18761 may overlap by standardizing tool path matching.

Fix summary: `read` permission checks use project-relative paths for files inside the worktree while keeping external paths absolute; regression test added.

Verification: `bun test test/tool/read.test.ts` pass, `bun typecheck` pass.

### #22054 - Insufficient Bash detection on Win32

URL: https://github.com/anomalyco/opencode/issues/22054

Status: PR opened

Branch: `fix/22054-windows-bash-detection`

PR: https://github.com/anomalyco/opencode/pull/24321

Open PR check: no open PR found for #22054, title, or `bash detection windows`.

Fix summary: `Shell.gitbash()` scans `PATH`, skips WSL Bash launchers and inaccessible entries, then falls back through Git for Windows and MSYS2 layouts; Windows tests added.

Verification: `bun test test/shell/shell.test.ts` pass, `bun typecheck` pass.

## Skipped Or Already Covered

| Issue  | Status                                | PR / reason                                                                                        |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| #23636 | Skipped, existing PR open             | #23635 closes #23636 and changes `packages/opencode/src/tool/bash.ts`.                             |
| #23519 | Skipped, existing related PR open     | Maintainer comment points to #18761.                                                               |
| #24003 | Skipped, existing related PR open     | #18392 makes bash `description` optional for the same invalid_type root cause.                     |
| #18792 | Skipped, existing PR open             | #18789 fixes Windows SDK `spawn opencode ENOENT` for `createOpencode`.                             |
| #15882 | Skipped, existing PR open             | #15883 adds the missing `Show reasoning summaries` translations.                                   |
| #21607 | Skipped, already covered / related PR | Current `dev` sorts log filenames before cleanup and #16628 also touches log cleanup.              |
| #15023 | Skipped, multiple related PRs open    | Session path normalization/query PRs include #20215, #23862, #20216, #20361, #23276.               |
| #23457 | Already fixed in current `dev`        | `ripgrep.ts` already inlines escaped `Expand-Archive` paths instead of using `$args`.              |
| #22280 | Already fixed in current `dev`        | `Npm.sanitize()` replaces Windows-illegal characters in git specs and has git HTTPS spec coverage. |

## Reviewed But Not Fixed Yet

| Issue  | Status                                     | Notes                                                                                                                                                          |
| ------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #20527 | Needs broader prompt/shell UX decision     | No open PR found. Current prompt already exposes OS/Shell and warns against `tail`; likely needs deliberate PowerShell tool/prompt refactor.                   |
| #20961 | Needs reproduction                         | No open PR found. Current `/init` template replaces `${path}` with `ctx.worktree`; reported `/<system-reminder>` corruption was not obvious from current code. |
| #20085 | Needs TUI/input reproduction               | Duplicate bot points to #19746; no code path selected yet.                                                                                                     |
| #23942 | Needs reproduction / likely duplicate      | Sparse `uv_spawn` report; bot points to #22586 and #21198.                                                                                                     |
| #23907 | Needs permission model decision            | Discussion questions deterministic enforcement for shell execution; not enough to safely patch from report alone.                                              |
| #23895 | Needs clarification                        | Agent color schema accepts hex and known theme tokens; request for arbitrary `blue` is unclear versus intended config contract.                                |
| #20661 | Needs schema/provider investigation        | MCP schema preserves `required`; optional fields with defaults may be over-specified by model/provider. No safe minimal patch yet.                             |
| #22281 | Needs plugin bundling reproduction         | Missing `default` export in bundled `cross-spawn` requires reproducing plugin build/runtime path.                                                              |
| #22072 | Needs streaming/export design              | Large-session export likely needs memory-safe serialization, not a small local fix.                                                                            |
| #22579 | Needs Desktop workspace-state reproduction | `/undo` corruption report is plausible but not enough to patch server-side safely.                                                                             |
| #14491 | Needs tool availability check              | Discard/extract tools are not obvious in current tool registry; needs reproduction against current dev.                                                        |

## Pending

Not yet reviewed in detail: 149 issues from the source query.
