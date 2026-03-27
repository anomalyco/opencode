# macOS Command Sandboxing Phase 2: Parity Plan

## Status

This is a handoff plan for phase 2 of macOS command sandboxing.
No implementation work is included.
Another engineer MUST be able to implement phase 2 from this plan without redoing discovery.

## Objective

Extend macOS Seatbelt sandboxing to cover all agent-visible local command surfaces,
implement sandbox-first execution with explicit host-level retry,
and close the most impactful gaps relative to Codex and Claude Code sandbox capabilities.

Phase 2 does NOT aim for full parity with either product.
It aims to get materially closer while keeping claims truthful.

## Phase-1 baseline

Phase 1 shipped sandbox coverage for exactly two non-interactive shell-command paths:

- `packages/opencode/src/tool/bash.ts` (the bash tool)
- `packages/opencode/src/session/prompt.ts` (`SessionPrompt.shell()`)

Phase 1 also delivered:

- `packages/opencode/src/sandbox/policy.ts` — SBPL profile builder
- `packages/opencode/src/sandbox/spawn.ts` — macOS wrapper, plan/resolve/wrap helpers
- Config surface under `experimental.sandbox` with `enabled`, `extra_read_roots`, `extra_write_roots`, `allow_unsandboxed_retry`
- `OPENCODE_EXPERIMENTAL_SANDBOX` env override via `flag/flag.ts`
- Default-deny posture with explicit read/write roots, credential-path deny rules, no network, no Unix sockets

Phase 1 explicitly does NOT cover:

- `packages/opencode/src/pty/index.ts` (PTY / interactive shell)
- MCP server process launch (`mcp/index.ts`)
- LSP server launch (`lsp/launch.ts`, `lsp/server.ts`)
- Shared spawn layers (`util/process.ts`, `effect/cross-spawn-spawner.ts`)
- Linux or Windows
- `allow_unsandboxed_retry` runtime behavior (config key exists, runtime does not implement it)

---

## Parity targets

### What Codex documents

Codex's sandbox model exposes three documented knobs:

- `sandbox_mode`: `read-only`, `workspace-write`, `danger-full-access`
- `approval_policy`: separate layer from sandbox
- `sandbox_workspace_write.writable_roots`: explicit writable path set

Sandbox and approval are independent layers.
The agent can run with a restrictive sandbox and a permissive approval policy, or vice versa.

### What Claude Code documents

Claude Code's sandbox model documents:

- Allow/deny filesystem controls scoped to explicit paths
- Domain-based and proxy-mediated network policy
- Excluded commands (command-level deny list)
- Intentional unsandboxed escape hatch
- `sandbox.failIfUnavailable` to hard-fail when the sandbox cannot activate

### What phase 2 targets

Phase 2 SHOULD close these gaps:

| Capability                                                 | Codex                             | Claude                          | Phase 2 target    |
| ---------------------------------------------------------- | --------------------------------- | ------------------------------- | ----------------- |
| PTY / interactive shell sandboxing                         | Supported (manual verification)   | Supported (manual verification) | Yes               |
| Sandbox-first with explicit host retry                     | Implicit via `danger-full-access` | Explicit escape hatch           | Yes               |
| Minimal sandbox modes                                      | Three modes                       | N/A                             | Two modes minimum |
| Richer filesystem policy (excluded paths, credential deny) | Writable roots                    | Allow/deny lists                | Yes               |
| Excluded commands                                          | Not documented                    | Documented                      | Yes               |
| Fail-if-unavailable                                        | Implicit (always sandboxed)       | `sandbox.failIfUnavailable`     | Yes               |
| Domain/proxy network mediation                             | Not documented                    | Documented                      | No (later phase)  |
| MCP sandboxing                                             | Not documented                    | Not documented                  | No (later phase)  |
| LSP sandboxing                                             | N/A                               | N/A                             | No (later phase)  |

PTY interactive shell support by Codex and Claude Code was confirmed through manual verification,
not through public documentation stronger than what those docs support.
Phase 2 treats this as established practice, not a guaranteed stable API contract.

---

## Non-goals for phase 2

Phase 2 MUST NOT:

1. Sandbox MCP server launches (`mcp/index.ts`).
   MCP processes run operator-configured commands with their own trust model.
   Sandboxing them requires separate design work around MCP-specific policy.

2. Sandbox LSP server launches (`lsp/launch.ts`, `lsp/server.ts`).
   LSP servers are internal infrastructure, not agent-visible command surfaces.

3. Wire `util/process.ts` or `effect/cross-spawn-spawner.ts` through the sandbox.
   These are shared spawn utilities used by internal tooling, formatters, and infrastructure.
   Broadly wiring them would silently sandbox non-agent processes.

4. Implement domain-based or proxy-mediated network controls.
   Claude Code's localhost proxy model is a substantial piece of infrastructure.
   Phase 2 SHOULD keep the current posture: network denied by default, optionally allowed via policy.

5. Support Linux or Windows sandboxing.
   macOS Seatbelt only.

6. Move sandbox config out of `experimental`.
   Phase 2 expands capabilities but the feature remains opt-in and experimental.

---

## Concrete files and modules

### Files to change

#### `packages/opencode/src/pty/index.ts`

Current state:

- `Pty.create()` calls `bun-pty` `spawn()` directly at line 201
- The spawn call passes `command`, `args`, `cwd`, and `env` to the native PTY
- No sandbox integration exists
- This is a major uncovered surface: interactive shells have full user privileges

Planned change:

- Before spawning, resolve sandbox plan via `SandboxSpawn.resolve()`
- When sandbox is active, wrap the PTY spawn command through `sandbox-exec`
- Pass the wrapped command/args to `bun-pty` `spawn()` instead of the raw shell
- The PTY process itself runs inside the sandbox; I/O streaming is unaffected because `sandbox-exec` preserves stdin/stdout/stderr
- Sandbox mode for PTY SHOULD use the same filesystem policy as `bash.ts`
- Shell rc-file sourcing in PTY sandbox mode SHOULD be addressed the same way as `session/prompt.ts`: prefer deterministic startup, do not grant broad `$HOME` reads

Sharp edges:

- `bun-pty` spawns a native PTY via `forkpty()`.
  The sandbox wraps the _command_ that the PTY executes, not the PTY allocation itself.
  This means the call becomes `bun-pty.spawn("sandbox-exec", ["-p", profile, shell, ...args], ...)`.
  This MUST be validated: the PTY allocator needs to handle `sandbox-exec` as the executable.
- Interactive programs (vim, htop) inside the sandbox will be subject to filesystem policy.
  This is expected behavior, not a bug.
- Terminal resize, `onData`, and `onExit` callbacks SHOULD be unaffected because they operate on the PTY fd, not the child process identity.

#### `packages/opencode/src/sandbox/spawn.ts`

Current state:

- `resolve()` reads config, detects platform, builds plan
- `plan()` validates roots, builds policy, returns active/inactive state
- `wrap()` produces `{ file: "sandbox-exec", args: ["-p", profile, ...] }`

Planned changes:

- Add `mode` support: accept a sandbox mode parameter and translate it to policy constraints
- Add `excluded_commands` checking: before wrapping, check the command against a deny list and throw a structured error if matched
- Add `fail_if_unavailable` behavior: when config says sandbox MUST be active but `sandbox-exec` is missing, throw a hard error instead of falling back to unsandboxed execution
- Add `unsandboxed_retry` support: export a helper that re-runs a command without the sandbox wrapper, gated behind explicit permission

#### `packages/opencode/src/sandbox/policy.ts`

Current state:

- `SandboxPolicy.build()` generates SBPL from structured input
- Supports read roots, write roots, deny roots, network, Unix sockets

Planned changes:

- Accept a `mode` input that maps to predefined policy profiles
- Add `excluded_commands` to the input; these are not SBPL rules but pre-spawn checks
- Optionally accept `extra_deny_paths` for operator-configured deny rules beyond the default credential set

#### `packages/opencode/src/config/config.ts`

Current state (lines 1020-1036):

```ts
sandbox: z.object({
  enabled: z.boolean().optional(),
  extra_read_roots: z.array(z.string()).optional(),
  extra_write_roots: z.array(z.string()).optional(),
  allow_unsandboxed_retry: z.boolean().optional(),
}).optional()
```

Planned changes — evolve the schema to:

```ts
sandbox: z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["workspace-write", "read-only"]).optional(),
  extra_read_roots: z.array(z.string()).optional(),
  extra_write_roots: z.array(z.string()).optional(),
  extra_deny_paths: z.array(z.string()).optional(),
  excluded_commands: z.array(z.string()).optional(),
  allow_unsandboxed_retry: z.boolean().optional(),
  fail_if_unavailable: z.boolean().optional(),
}).optional()
```

Field semantics:

- `mode`: defaults to `"workspace-write"`.
  `"workspace-write"` allows writes to project root and configured extra write roots.
  `"read-only"` denies all writes except `/tmp` and explicitly configured paths.
- `extra_deny_paths`: operator-specified paths to deny beyond the default credential set.
- `excluded_commands`: command prefixes that MUST NOT execute even inside the sandbox.
  If the agent attempts an excluded command, execution MUST fail with a structured error before spawning.
- `fail_if_unavailable`: when `true`, sandbox activation failure (missing `sandbox-exec`, unsupported platform) is a hard error.
  Default `false` for backward compatibility.

#### `packages/opencode/src/tool/bash.ts`

Current state:

- Already wired through `SandboxSpawn.resolve()` and `SandboxSpawn.wrap()`
- No excluded-command checking
- No unsandboxed retry

Planned changes:

- Before sandbox resolution, check the parsed command against `excluded_commands` and fail early if matched
- After a sandbox denial, if `allow_unsandboxed_retry` is `true`, present a distinct permission prompt for unsandboxed re-execution
- Pass the selected `mode` to `SandboxSpawn.resolve()`

#### `packages/opencode/src/session/prompt.ts`

Current state:

- `SessionPrompt.shell()` (line 1542) already wired through `SandboxSpawn.resolve()`
- No excluded-command checking
- No unsandboxed retry

Planned changes:

- Mirror the same excluded-command and unsandboxed-retry changes as `bash.ts`
- Pass the selected `mode` to `SandboxSpawn.resolve()`

#### `packages/opencode/src/permission/index.ts`

Current state:

- `Permission.ask()` evaluates rulesets and prompts the user
- No awareness of sandbox retry

Planned change:

- No structural change required.
  The unsandboxed retry prompt SHOULD use the existing `Permission.ask()` with a distinct permission key (e.g., `"bash:unsandboxed"`) so that operators can pre-allow or pre-deny it via config.

### Files explicitly NOT changed in phase 2

| File                                                  | Reason                                     |
| ----------------------------------------------------- | ------------------------------------------ |
| `packages/opencode/src/util/process.ts`               | Internal spawn utility, not agent-visible  |
| `packages/opencode/src/effect/cross-spawn-spawner.ts` | Effect-layer spawn, used by infrastructure |
| `packages/opencode/src/mcp/index.ts`                  | MCP server launch, separate trust model    |
| `packages/opencode/src/lsp/launch.ts`                 | LSP launch, internal tooling               |
| `packages/opencode/src/lsp/server.ts`                 | LSP server management, internal tooling    |

---

## Sequencing

### Phase 2a — PTY sandbox integration

Goal: sandbox interactive shell sessions on macOS when enabled.

Steps:

1. Validate that `bun-pty` `spawn()` correctly executes `sandbox-exec -p <profile> <shell> <args>` as the PTY command.
   This is the critical proof step.
   If `bun-pty` cannot run a wrapped command, the approach needs revision.
2. Wire `SandboxSpawn.resolve()` into `Pty.create()` before the `spawn()` call.
3. When sandbox is active, replace the raw `command` + `args` with the wrapped version.
4. Validate that terminal I/O (`onData`, `onExit`, resize) still works through the wrapper.
5. Validate that interactive programs (shell builtins, vim, git interactive rebase) work inside the sandbox.

Exit criteria:

- PTY sessions respect sandbox policy when enabled
- Terminal I/O is not broken
- Interactive programs that stay within allowed paths work
- Programs that attempt denied operations fail with Seatbelt denials visible in stderr

QA:

- From `packages/opencode`, run `bun run typecheck`
- Add test coverage in `packages/opencode/test/pty/` or extend existing PTY tests
- Manual verification: create a PTY session with sandbox enabled, run `ls`, `cat`, `echo`, confirm output streams correctly
- Manual verification: attempt `cat ~/.ssh/id_rsa` inside sandboxed PTY, confirm denial

### Phase 2b — sandbox modes

Goal: implement `workspace-write` and `read-only` modes.

Steps:

1. Add `mode` to `SandboxPolicy.Input`
2. In `SandboxPolicy.build()`, when mode is `"read-only"`, move project root and worktree root from write roots to read-only roots.
   Only `/tmp`, `/private/tmp`, and explicitly configured extra write roots remain writable.
3. In `SandboxSpawn.resolve()`, read `mode` from config and pass it through.
4. Update `bash.ts`, `session/prompt.ts`, and `pty/index.ts` to forward the mode.

Exit criteria:

- `"workspace-write"` behaves identically to current phase-1 behavior
- `"read-only"` denies writes to the project root
- Default is `"workspace-write"` for backward compatibility

QA:

- Unit tests in `packages/opencode/test/sandbox/policy.test.ts` for both modes
- Integration test: with `mode: "read-only"`, `touch newfile.txt` in project root MUST fail
- Integration test: with `mode: "workspace-write"`, `touch newfile.txt` in project root MUST succeed

### Phase 2c — excluded commands

Goal: block specific commands before they reach the sandbox.

Steps:

1. Add `excluded_commands` to config schema.
2. In `SandboxSpawn` (or a new helper), add a check function that takes the parsed command and the exclusion list,
   and returns a structured error if the command matches.
3. Wire the check into `bash.ts` (after tree-sitter parse, before spawn) and `session/prompt.ts` (before spawn).
4. Wire the check into `pty/index.ts` for the initial PTY command (not subsequent interactive input — that is out of scope for phase 2).

Design note:

- Excluded commands are a pre-spawn deny list, not an SBPL rule.
  SBPL cannot reason about command names; it operates on file paths and syscalls.
- Matching SHOULD use the same command prefix logic as `BashArity.prefix()` in `packages/opencode/src/permission/arity.ts`.
- For PTY, the check applies only to the initial spawn command.
  Once the interactive shell is running, the user (or agent) can type anything.
  This is a known limitation and SHOULD be documented.

Exit criteria:

- A command matching the exclusion list fails with a clear error message before spawning
- Non-excluded commands are unaffected

QA:

- Add or extend tests at `packages/opencode/test/sandbox/spawn.test.ts` covering the exclusion checker.
- From `packages/opencode`, run:
  `bun run typecheck`
- From `packages/opencode`, run:
  `bun test --timeout 30000 test/sandbox/spawn.test.ts`
- Expected result for unit tests:
  - A command whose prefix matches an entry in `excluded_commands` returns a structured error before any spawn call
  - A command that does not match any exclusion proceeds normally
- Add an integration test in `packages/opencode/test/tool/bash.test.ts` (or a dedicated `bash-sandbox.test.ts`):
  - Configure `excluded_commands: ["rm"]`
  - Invoke the bash tool with `rm -rf /tmp/test`
  - Expected result: the tool rejects the command with an error containing the excluded command name; no child process is spawned
- Add an integration test for `session/prompt.ts`:
  - Configure `excluded_commands: ["curl"]`
  - Call `SessionPrompt.shell()` with `curl https://example.com`
  - Expected result: shell execution fails with a structured error before spawning
- Manual verification for PTY:
  - Set `excluded_commands: ["python"]` in `opencode.json` under `experimental.sandbox`
  - Create a PTY session with `command: "python"`
  - Expected result: PTY creation fails with a clear error; no interactive session starts
  - Create a PTY session with the default shell (not in the exclusion list)
  - Expected result: PTY session starts normally

### Phase 2d — fail-if-unavailable

Goal: hard-fail when sandbox is required but cannot activate.

Steps:

1. Add `fail_if_unavailable` to config schema.
2. In `SandboxSpawn.resolve()`, when `fail_if_unavailable` is `true` and the plan returns `active: false` with reason `unsupported_platform` or `sandbox_exec_missing`, throw `SandboxSpawn.Error` instead of returning an inactive plan.
3. Currently, `SandboxSpawn.plan()` already throws for `sandbox_exec_missing` when `requested` is `true`.
   Extend this to also throw for `unsupported_platform` when `fail_if_unavailable` is `true`.

Exit criteria:

- On a non-macOS platform with `fail_if_unavailable: true`, command execution fails with a structured error
- On macOS without `sandbox-exec` (unlikely but testable), same behavior
- With `fail_if_unavailable: false` (default), current fallback behavior is preserved

QA:

- Add or extend tests at `packages/opencode/test/sandbox/spawn.test.ts`.
- From `packages/opencode`, run:
  `bun run typecheck`
- From `packages/opencode`, run:
  `bun test --timeout 30000 test/sandbox/spawn.test.ts`
- Test case 1 — hard failure on unsupported platform:
  - Call `SandboxSpawn.plan()` with `requested: true`, `platform: "linux"`, and `fail_if_unavailable: true`
  - Expected result: throws `SandboxSpawn.Error` with reason `unsupported_platform`
- Test case 2 — hard failure when `sandbox-exec` is missing:
  - Call `SandboxSpawn.plan()` with `requested: true`, `platform: "darwin"`, `available: false`, and `fail_if_unavailable: true`
  - Expected result: throws `SandboxSpawn.Error` with reason `sandbox_exec_missing`
- Test case 3 — graceful fallback when `fail_if_unavailable` is `false`:
  - Call `SandboxSpawn.plan()` with `requested: true`, `platform: "linux"`, and `fail_if_unavailable: false`
  - Expected result: returns `{ active: false }` with reason `unsupported_platform`; no error thrown
- Test case 4 — backward compatibility:
  - Call `SandboxSpawn.plan()` with `requested: true`, `platform: "linux"`, and no `fail_if_unavailable` field
  - Expected result: same as test case 3; defaults to `false`
- Manual verification:
  - On a macOS host, set `fail_if_unavailable: true` and `enabled: true` in `opencode.json`
  - Run a bash tool command
  - Expected result: command executes inside the sandbox normally (sandbox-exec is present)
  - On a Linux host (or by temporarily renaming `/usr/bin/sandbox-exec`), repeat
  - Expected result: command fails immediately with a structured error mentioning sandbox unavailability

### Phase 2e — unsandboxed retry

Goal: implement the `allow_unsandboxed_retry` runtime path.

Steps:

1. Define a new permission key `"bash:unsandboxed"` (or similar) that operators can pre-configure.
2. In `bash.ts`, after a sandbox denial (child exits non-zero with Seatbelt-related stderr), detect the denial.
3. If `allow_unsandboxed_retry` is `true`, prompt the user via `Permission.ask()` with the `"bash:unsandboxed"` key and the original command as the pattern.
4. If approved, re-run the command without the sandbox wrapper.
5. Mirror the same logic in `session/prompt.ts`.
6. For PTY, unsandboxed retry is NOT implemented in phase 2.
   Restarting a PTY session outside the sandbox mid-stream is complex and error-prone.
   Document this as a known limitation.

Sharp edges:

- Detecting a Seatbelt denial from the child's exit code and stderr is heuristic.
  `sandbox-exec` does not set a distinct exit code for policy violations.
  The implementation SHOULD look for `deny` or `Sandbox:` in stderr as a signal, but MUST NOT treat this as authoritative.
- The retry path MUST re-run the entire command, not attempt to resume partial output.
- The retry permission MUST be distinct from the original bash permission so operators can deny retries globally.

Exit criteria:

- When `allow_unsandboxed_retry` is `false` (default), no retry is offered
- When `true` and a sandbox denial occurs, the user is prompted
- If the user approves, the command runs unsandboxed and produces output normally
- If the user rejects, the original sandbox denial stands

QA:

- Add or extend tests at `packages/opencode/test/tool/bash.test.ts` (or a dedicated `bash-sandbox.test.ts`).
- From `packages/opencode`, run:
  `bun run typecheck`
- From `packages/opencode`, run:
  `bun test --timeout 30000 test/tool/bash.test.ts`
  (or `bun test --timeout 30000 test/tool/bash-sandbox.test.ts` if a dedicated file is added)
- Test case 1 — retry disabled (default):
  - Configure `allow_unsandboxed_retry: false` (or omit the field)
  - Run a bash tool command that triggers a sandbox denial (e.g., write outside project root)
  - Expected result: command fails with sandbox denial output; no retry prompt is issued; `Permission.ask()` is NOT called with `"bash:unsandboxed"`
- Test case 2 — retry enabled, user approves:
  - Configure `allow_unsandboxed_retry: true`
  - Run a bash tool command that triggers a sandbox denial
  - Stub or pre-allow the `"bash:unsandboxed"` permission
  - Expected result: after the initial sandbox denial, the command re-runs without the sandbox wrapper and produces normal output
- Test case 3 — retry enabled, user rejects:
  - Configure `allow_unsandboxed_retry: true`
  - Run a bash tool command that triggers a sandbox denial
  - Stub or pre-deny the `"bash:unsandboxed"` permission
  - Expected result: the original sandbox denial stands; no unsandboxed execution occurs
- Add a parallel test in `packages/opencode/test/session/prompt.test.ts` (or `prompt-sandbox.test.ts`):
  - Configure `allow_unsandboxed_retry: true`
  - Call `SessionPrompt.shell()` with a command that triggers a sandbox denial
  - Pre-allow the `"bash:unsandboxed"` permission
  - Expected result: command re-runs unsandboxed; output streams correctly
- Manual verification:
  - Set `allow_unsandboxed_retry: true` and `enabled: true` in `opencode.json`
  - In the TUI, run a bash command that writes to a path outside the project root (e.g., `touch /tmp/outside-project/test.txt` where the parent dir is not in extra write roots)
  - Expected result: a permission prompt appears asking to retry without the sandbox
  - Accept the prompt
  - Expected result: the command runs unsandboxed and succeeds
  - Repeat, but reject the prompt
  - Expected result: the command remains failed with the original sandbox denial

### Phase 2f — config evolution and docs

Goal: ship accurate documentation for phase 2 capabilities.

Steps:

1. Update `SECURITY.md` to reflect expanded coverage: bash tool, session command, and PTY sessions.
2. Document the new config fields: `mode`, `excluded_commands`, `fail_if_unavailable`, `extra_deny_paths`.
3. Document exclusions: MCP, LSP, internal spawn layers, non-macOS, domain-mediated network.
4. Document the unsandboxed retry flow and its limitations.
5. Document that PTY excluded-command checking applies only to the initial spawn, not interactive input.

Exit criteria:

- Docs match actual coverage
- No overclaiming

QA:

- From the repo root, run:
  `grep -n "PTY\|interactive\|MCP\|LSP\|non-macOS\|excluded.command\|unsandboxed.retry\|fail.if.unavailable" SECURITY.md`
- Expected result:
  - `SECURITY.md` explicitly states macOS-only, opt-in, and experimental
  - `SECURITY.md` lists bash tool, session command, and PTY interactive sessions as covered surfaces
  - `SECURITY.md` explicitly names MCP, LSP, internal process utilities, domain-mediated network, and non-macOS as exclusions
  - `SECURITY.md` documents that PTY excluded-command checking applies only to the initial spawn, not interactive input
  - No section implies all local process execution is sandboxed
- Verify config documentation:
  - From the repo root, run:
    `grep -n "mode\|excluded_commands\|fail_if_unavailable\|extra_deny_paths" SECURITY.md`
  - Expected result: each new config field is mentioned with a brief description of its behavior and default value
- Verify unsandboxed retry documentation:
  - `SECURITY.md` or a linked doc describes the retry flow: sandbox denial, permission prompt with `"bash:unsandboxed"` key, re-execution without wrapper
  - The doc notes that PTY sessions do not support unsandboxed retry in phase 2
- Manual review:
  - Read `SECURITY.md` end to end after edits
  - Confirm no sentence claims coverage beyond what the validation matrix proved
  - Confirm the phase-2 product statement in this plan matches the claims in `SECURITY.md`

---

## Validation matrix

### Unit tests

| Test                                         | Location                      |
| -------------------------------------------- | ----------------------------- |
| Policy generation for `workspace-write` mode | `test/sandbox/policy.test.ts` |
| Policy generation for `read-only` mode       | `test/sandbox/policy.test.ts` |
| Excluded command matching                    | `test/sandbox/spawn.test.ts`  |
| `fail_if_unavailable` throws on non-darwin   | `test/sandbox/spawn.test.ts`  |
| Unsandboxed retry permission key             | `test/sandbox/spawn.test.ts`  |
| Config parsing for new fields                | `test/config/`                |

### macOS integration tests

| #   | Test                                                                 | Expected                                 |
| --- | -------------------------------------------------------------------- | ---------------------------------------- |
| 1   | PTY session with sandbox enabled, `ls` in project root               | Succeeds, output streams                 |
| 2   | PTY session with sandbox enabled, `cat ~/.ssh/id_rsa`                | Fails with Seatbelt denial               |
| 3   | PTY session with sandbox enabled, terminal resize                    | Resize works                             |
| 4   | PTY session with sandbox enabled, interactive program (e.g., `less`) | Runs if file is in allowed path          |
| 5   | `read-only` mode, `touch newfile.txt` in project root                | Fails                                    |
| 6   | `read-only` mode, `cat` a project file                               | Succeeds                                 |
| 7   | `workspace-write` mode, `touch newfile.txt` in project root          | Succeeds                                 |
| 8   | Excluded command in bash tool                                        | Fails before spawn with structured error |
| 9   | Excluded command in PTY initial spawn                                | Fails before spawn                       |
| 10  | `fail_if_unavailable: true` on non-darwin                            | Hard error                               |
| 11  | `allow_unsandboxed_retry: true`, sandbox denial, user approves       | Command re-runs unsandboxed              |
| 12  | `allow_unsandboxed_retry: true`, sandbox denial, user rejects        | Original denial stands                   |
| 13  | `allow_unsandboxed_retry: false`, sandbox denial                     | No retry offered                         |

### Manual verification

Before updating docs:

1. Build the darwin binary with the Bun compile pipeline.
2. Open a PTY session with sandbox enabled and run common interactive workflows.
3. Verify that `bun-pty` correctly spawns `sandbox-exec` as the PTY command.
4. Verify that sandbox denials are visible in PTY stderr output.
5. Test excluded-command blocking in both bash tool and PTY.

---

## Risks and sharp edges

### `bun-pty` and `sandbox-exec` interaction

This is the highest-risk item in phase 2.
`bun-pty` uses `forkpty()` to allocate a pseudo-terminal and exec the command.
The command becomes `sandbox-exec -p <profile> /bin/zsh -l`.
If `forkpty()` + `execvp("sandbox-exec", ...)` does not work correctly,
the entire PTY sandboxing approach needs revision.

Mitigation: validate this in phase 2a before any other work.

### PTY excluded-command limitation

Excluded-command checking for PTY applies only to the initial spawn command.
Once an interactive shell is running, the user or agent can type any command.
This is an inherent limitation of pre-spawn deny lists.

Mitigation: document this clearly. Do not claim that excluded commands are enforced inside interactive sessions.

### Seatbelt denial detection heuristic

There is no reliable programmatic way to distinguish a Seatbelt denial from other non-zero exits.
The retry path relies on stderr heuristics.

Mitigation: make the heuristic conservative. Better to miss a retry opportunity than to offer retry on a non-sandbox failure.

### `sandbox-exec` deprecation

Apple has not removed `sandbox-exec` but has deprecated the Seatbelt API.
Both Codex and Claude Code still rely on it.
This risk is inherited from phase 1 and unchanged.

### Mode default and backward compatibility

Phase 1 has no `mode` concept.
Phase 2 MUST default to `"workspace-write"` so that existing phase-1 users see no behavior change.

### Shell rc-file sourcing in PTY sandbox mode

PTY sessions typically source `~/.zshrc`, `~/.bashrc`, etc.
Sandbox mode cannot safely allow broad `$HOME` reads for this.
Users MAY experience different shell behavior in sandboxed PTY sessions.

Mitigation: document this. Prefer deterministic shell startup in sandbox mode.

---

## Open questions

1. Does `bun-pty` `spawn()` correctly execute `sandbox-exec` as the PTY command?
   This MUST be validated before committing to the PTY approach.

2. Should `read-only` mode allow writes to `/tmp` and `/private/tmp`,
   or should it deny all writes except explicitly configured paths?

3. What is the right UX for the unsandboxed retry prompt?
   Should it show the original command, the denial reason, or both?

4. Should excluded-command matching be exact prefix or glob-based?
   Prefix matching via `BashArity.prefix()` is simpler and consistent with existing permission arity.

5. Should `fail_if_unavailable` be separate from `enabled`,
   or should there be a three-state `enabled` field (`true`, `false`, `"required"`)?

6. What default `excluded_commands` list (if any) should ship with phase 2?
   Candidates: `rm -rf /`, `chmod 777`, `curl | sh`, `eval`.

---

## Phase-2 product statement

If phase 2 ships successfully,
the correct security statement is:

> On macOS,
> opencode can optionally sandbox agent-issued shell commands from the bash tool, session command path, and PTY interactive sessions.
> The sandbox supports workspace-write and read-only modes,
> excluded-command blocking (pre-spawn only),
> and an explicit unsandboxed retry path gated behind a distinct permission prompt.
> MCP servers,
> LSP servers,
> internal process utilities,
> domain-mediated network controls,
> and non-macOS platforms are not covered by this phase.

Anything broader than that is inaccurate.

---

## Later phases

Phase 2 intentionally defers the following.
Each item has its own design considerations.

| Item                                  | Why deferred                                         | Likely phase     |
| ------------------------------------- | ---------------------------------------------------- | ---------------- |
| MCP server sandboxing                 | Separate trust model; operator-configured commands   | Phase 3          |
| LSP server sandboxing                 | Internal infrastructure, not agent-visible           | Phase 3 or later |
| `util/process.ts` wiring              | Shared by non-agent code paths                       | Phase 3 or later |
| `cross-spawn-spawner.ts` wiring       | Effect-layer spawn, infrastructure                   | Phase 3 or later |
| Domain/proxy network mediation        | Substantial infrastructure (localhost proxy)         | Phase 4+         |
| Linux sandboxing                      | Different mechanism (e.g., bubblewrap, namespaces)   | Phase 4+         |
| Windows sandboxing                    | Different mechanism entirely                         | Phase 5+         |
| Interactive-session excluded commands | Requires in-band command interception, not pre-spawn | Research         |

---

## Rollout plan

1. Ship phase 2a (PTY integration) behind the existing `experimental.sandbox.enabled` flag.
   No new flag required.
2. Ship phase 2b (modes) with `mode` defaulting to `"workspace-write"`.
   No behavior change for existing users.
3. Ship phase 2c (excluded commands) with an empty default list.
   Operators opt in by configuring `excluded_commands`.
4. Ship phase 2d (fail-if-unavailable) with `fail_if_unavailable` defaulting to `false`.
5. Ship phase 2e (unsandboxed retry) with `allow_unsandboxed_retry` defaulting to `false` (unchanged from phase 1).
6. Ship phase 2f (docs) only after manual verification of the full validation matrix.

Each sub-phase MAY ship independently.
They have no hard ordering dependencies except that 2a SHOULD land first because it validates the PTY approach.

---

## Pickup checklist for the next agent

1. Read this file fully before touching code.
2. Read the phase-1 handoff plan at `.sisyphus/plans/macos-command-sandboxing-handoff.md` for context.
3. Re-read these repo files before planning edits:
   - `packages/opencode/src/pty/index.ts` (PTY spawn at line 201)
   - `packages/opencode/src/sandbox/policy.ts` (SBPL builder)
   - `packages/opencode/src/sandbox/spawn.ts` (wrapper, plan, resolve)
   - `packages/opencode/src/tool/bash.ts` (current sandbox wiring)
   - `packages/opencode/src/session/prompt.ts` (`shell()` at line 1542, current sandbox wiring at line 1729)
   - `packages/opencode/src/config/config.ts` (sandbox config at line 1020)
   - `packages/opencode/src/permission/index.ts` (permission ask/reply)
   - `packages/opencode/src/permission/evaluate.ts` (rule evaluation)
   - `packages/opencode/src/permission/arity.ts` (command prefix matching)
4. Start with phase 2a proof work: validate `bun-pty` + `sandbox-exec`.
   Do NOT proceed with other sub-phases until this is confirmed.
5. Do NOT wire `util/process.ts`, `cross-spawn-spawner.ts`, `mcp/index.ts`, or `lsp/*`.
6. Do NOT claim domain-mediated network controls.
7. Do NOT allow broad `$HOME` reads for PTY shell rc-file sourcing.
8. Do NOT update `SECURITY.md` until the validation matrix passes.
9. Default all new config fields to backward-compatible values.
10. Use the existing `Permission.ask()` flow for unsandboxed retry; do not create a parallel permission system.
