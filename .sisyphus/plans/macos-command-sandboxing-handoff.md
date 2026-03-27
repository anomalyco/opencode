# macOS Command Sandboxing Handoff Plan

## Status

This is a handoff plan only.
No implementation work is included.
The goal is to let another agent pick this up later without repeating discovery.

## Objective

Add real macOS command sandboxing to opencode for agent-issued shell commands.
The first shippable phase should cover only the two arbitrary shell-command paths:
`packages/opencode/src/tool/bash.ts` and `packages/opencode/src/session/prompt.ts`.
The enforcement mechanism should be macOS Seatbelt via `/usr/bin/sandbox-exec -p <profile>`.
The sandbox should sit below the existing permission prompts.

## Why this is needed

`SECURITY.md` explicitly says opencode does **not** sandbox the agent.
Today, the permission system is a UX gate, not a security boundary.
Once permission is granted, the command runs with the full privileges of the current user.

## Confirmed repo facts

### Existing arbitrary shell-command paths

- `packages/opencode/src/tool/bash.ts`
  - Parses the command for permission prompts.
  - Calls `child_process.spawn` directly.
  - Uses `Shell.acceptable()` from `packages/opencode/src/shell/shell.ts`.
- `packages/opencode/src/session/prompt.ts`
  - Builds shell-specific invocation arguments.
  - Calls `child_process.spawn` directly.
  - Currently sources shell rc files for some shells before `eval`.

### Shared spawn layers that exist, but should not be claimed as phase-1 coverage

- `packages/opencode/src/util/process.ts`
- `packages/opencode/src/effect/cross-spawn-spawner.ts`
- `packages/opencode/src/lsp/launch.ts`
- `packages/opencode/src/lsp/server.ts`

These are part of the larger spawn surface.
They matter for later expansion, but wiring them in phase 1 would silently broaden scope to LSP and internal tooling.

### Explicitly out of scope for phase 1

- `packages/opencode/src/pty/index.ts`
  - PTY / interactive shell path.
  - High compatibility risk.
- `packages/opencode/src/mcp/index.ts`
  - Local MCP server process launch.
  - Separate risk surface.
- Linux.
- Windows.

### Permission and config paths

- `packages/opencode/src/config/config.ts`
  - Current permission config surface.
- `packages/opencode/src/permission/index.ts`
  - Current runtime permission enforcement.
- `packages/opencode/src/flag/flag.ts`
  - Current env-flag surface.

## Confirmed external evidence

- Codex uses macOS Seatbelt via `/usr/bin/sandbox-exec -p <profile>`.
- Claude Code documents macOS Seatbelt and uses a localhost proxy for controlled networking.
- Anthropic's open-source sandbox runtime generates SBPL dynamically,
  uses default-deny,
  scopes file access to explicit roots,
  and treats Unix sockets as dangerous.
- Oracle recommendation:
  add one sandbox launcher under local command execution,
  ship non-interactive flows first,
  and do not pretend PTY has parity in v1.
- Red-team review:
  do not overclaim broad spawn coverage,
  do not allow broad `$HOME` reads,
  do not leave Unix sockets open while claiming network deny,
  and do not assume Bun-compiled darwin binaries work correctly with `sandbox-exec` until proven.

## Phase-1 product statement

If phase 1 ships successfully,
the correct security statement is:

> On macOS,
> opencode can optionally sandbox agent-issued non-interactive shell commands from the bash tool and session command path.
> PTY sessions,
> MCP servers,
> LSP servers,
> and non-macOS platforms are not covered by this phase.

Anything broader than that is inaccurate.

## Phase-1 design

### Design principles

1. Make scope narrow and explicit.
2. Use a reusable sandbox module,
   but only wire it into the two in-scope shell-command paths first.
3. Keep permission prompts as the UX layer.
4. Treat the sandbox as the OS enforcement layer.
5. Prefer deny-by-default over permissive compatibility shortcuts.
6. Avoid broad `$HOME` read access.
7. Deny Unix sockets in phase 1.
8. Prove Bun-compiled darwin compatibility before changing core execution paths.

### New modules to add

#### `packages/opencode/src/sandbox/policy.ts`

Responsible for generating the Seatbelt policy string.
Inputs should be plain data.
Avoid hiding filesystem lookups inside the policy builder.

Suggested inputs:

- `cwd`
- `project_root`
- `worktree_root`
- `extra_read_roots`
- `extra_write_roots`
- `allow_network`
- `allow_unix_sockets`

Suggested output:

- one SBPL string for use with `/usr/bin/sandbox-exec -p <profile>`

#### `packages/opencode/src/sandbox/spawn.ts`

Responsible for the macOS-specific wrapper logic.
This module should not decide product policy.
It should only translate validated inputs into a wrapped command.

Suggested responsibilities:

- detect whether sandboxing is enabled
- guard on `process.platform === "darwin"`
- guard on `/usr/bin/sandbox-exec` existing
- build the wrapped argv array
- provide structured diagnostics when the wrapper cannot run

Suggested shape:

- a pure helper that returns wrapped argv
- a small runtime helper that executes or delegates to existing spawn logic

### Files to change in phase 1

#### `packages/opencode/src/tool/bash.ts`

Current state:

- computes permission patterns
- asks for `external_directory` and `bash`
- then spawns the command directly

Planned change:

- after permission is granted,
  route execution through the macOS sandbox wrapper when sandboxing is enabled
- do not rely on Node's `shell: true` path in sandbox mode
- instead,
  build an explicit shell command argv using `Shell.acceptable()`
  and pass that argv through the wrapper

Why:

- sandboxing an explicit argv is easier to reason about than stacking `shell: true` under the wrapper
- it makes the executed shell binary visible and testable

#### `packages/opencode/src/session/prompt.ts`

Current state:

- builds shell-specific args
- directly spawns the shell
- currently sources shell rc files in some code paths

Planned change:

- route the final shell argv through the same sandbox wrapper in sandbox mode
- do **not** expand the policy to broad `$HOME` reads just to preserve shell personalization
- prefer deterministic shell startup in sandbox mode,
  even if that means reducing or disabling rc-file sourcing there

Sharp edge:

- this path currently reads `~/.zshenv`,
  `~/.zshrc`,
  and `~/.bashrc` in some cases
- broad `$HOME` reads are too risky
- phase 1 should favor a minimal shell environment plus the existing `shell.env` plugin hook,
  not full shell personalization

#### `packages/opencode/src/config/config.ts`

Add an opt-in config surface.
Keep it under `experimental` for phase 1.

Suggested shape:

```ts
experimental: {
  sandbox: {
    enabled?: boolean
    extra_read_roots?: string[]
    extra_write_roots?: string[]
    allow_unsandboxed_retry?: boolean
  }
}
```

Notes:

- keep the default `enabled` value `false` for the first rollout
- use explicit read and write roots,
  not a vague `allowPaths`
- `allow_unsandboxed_retry` must default to `false`

#### `packages/opencode/src/flag/flag.ts`

Add an env override for local testing.

Suggested flag:

- `OPENCODE_EXPERIMENTAL_SANDBOX`

This should be an override,
not the only control surface.

#### `SECURITY.md`

Update only after validation passes.
The update must name both coverage and exclusions.
Do not describe the feature as general command sandboxing across the product.

## Phase-1 policy

### High-level posture

- default deny
- explicit read roots
- explicit write roots
- no outbound network
- no Unix sockets
- no broad `$HOME` reads

### Allow rules the implementation will likely need

These are policy categories,
not exact final SBPL syntax.

#### Read-only roots

- project root
- current worktree root
- `/bin`
- `/usr`
- `/System`
- `/Library`
- `/tmp`
- `/private/tmp`
- `/dev`
- `/opt/homebrew` on Apple Silicon machines,
  if read-only access is needed
- `/usr/local` on Intel/Homebrew machines,
  if read-only access is needed
- `/nix/store` only if the operator explicitly adds it

#### Writable roots

- project root
- current worktree root
- temp dir only if required by actual command behavior
- explicitly configured extra write roots

Keep this list small.
Do not open general cache directories until a concrete failing workflow requires it.

### Explicit deny intent

Phase 1 should explicitly deny access to:

- outbound network
- loopback network unless a later phase introduces controlled mediation
- Unix sockets
- credential-heavy home paths,
  including at minimum:
  - `~/.ssh`
  - `~/.gnupg`
  - `~/.aws`
  - `~/.azure`
  - `~/.config/gcloud`
  - `~/.netrc`
  - `~/.npmrc`
  - opencode config and state directories

Do not loosen this just to reduce breakage.
Breakage is preferable to fake security.

## Interaction with existing permissions

The existing permission system stays in place.

Correct mental model:

- permission prompt decides whether the agent is allowed to attempt the tool call
- sandbox decides what the spawned command can actually do on the host

This means:

- permission allow + sandbox deny = command still denied by sandbox
- permission deny = command denied before sandbox execution

If the product wants a rerun outside the sandbox,
that must be explicit.

Recommended product rule:

- add a separate unsandboxed retry path only if needed
- gate it behind a distinct permission
- never widen the sandbox automatically after a denial

## Rollout plan

### Phase 0 — inventory and proof work

Goal:
prove the wrapper mechanism before integrating it.

Steps:

1. Audit the full spawn surface once,
   and write down the classification:
   - shell-command
   - internal-tool
   - mcp
   - pty
   - cli-only
2. Build a small local proof that a Bun-compiled darwin binary can launch a child via
   `/usr/bin/sandbox-exec -p <profile>`.
3. Prove that inline `-p` policy strings work correctly,
   so the implementation does not need temp profile files.

Exit criteria:

- confirmed compatibility on a macOS host
- concrete list of uncovered spawn families for later phases

QA for this phase:

- from `packages/opencode`, run `bun run build -- --single`
- on Apple Silicon, run `./dist/opencode-darwin-arm64/bin/opencode --version`
- on Intel, run `./dist/opencode-darwin-x64/bin/opencode --version`
- then run the same compiled binary through Seatbelt with a proof-only profile:
  - Apple Silicon:
    `/usr/bin/sandbox-exec -p '(version 1) (allow default)' ./dist/opencode-darwin-arm64/bin/opencode --version`
  - Intel:
    `/usr/bin/sandbox-exec -p '(version 1) (allow default)' ./dist/opencode-darwin-x64/bin/opencode --version`
- expected result:
  - both commands exit `0`
  - both print a version string
  - the wrapped binary does not crash or fail due to Bun compile/runtime issues
- optional extra proof from the same macOS shell:
  `/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' /bin/bash -lc 'curl -I https://example.com'`
- expected result:
  - the curl command fails with a network denial
  - this proves the host accepts inline `-p` policies before opencode integration starts

### Phase 1a — reusable sandbox modules

Goal:
land `sandbox/policy.ts` and `sandbox/spawn.ts` with no behavior change by default.

Steps:

1. Add config parsing and env override.
2. Add the policy builder.
3. Add the wrapper helper.
4. Add unit tests for profile generation and wrapper argv generation.

Exit criteria:

- code compiles
- tests pass
- feature remains off by default

QA for this phase:

- add dedicated tests at:
  - `packages/opencode/test/sandbox/policy.test.ts`
  - `packages/opencode/test/sandbox/spawn.test.ts`
- from `packages/opencode`, run `bun run typecheck`
- from `packages/opencode`, run `bun test --timeout 30000 test/sandbox/policy.test.ts test/sandbox/spawn.test.ts`
- expected result:
  - typecheck exits `0`
  - both sandbox unit test files pass
  - with sandbox disabled by default, existing behavior is unchanged

### Phase 1b — integrate `bash.ts`

Goal:
sandbox the bash tool on macOS when enabled.

Steps:

1. keep the existing permission flow intact
2. switch sandboxed execution to explicit shell argv
3. add integration tests for allowed and denied behavior
4. verify abort and timeout behavior still work through the wrapper

Exit criteria:

- bash tool still works for in-project read and write operations
- denied operations fail predictably
- timeout and abort still terminate the child correctly

QA for this phase:

- add focused coverage in either:
  - `packages/opencode/test/tool/bash.test.ts`, or
  - a new `packages/opencode/test/tool/bash-sandbox.test.ts`
- from `packages/opencode`, run:
  - `bun test --timeout 30000 test/tool/bash.test.ts`
    if the existing file is extended, or
  - `bun test --timeout 30000 test/tool/bash-sandbox.test.ts`
    if a dedicated file is added
- expected result:
  - a command that reads or writes inside the fixture project succeeds
  - a command that writes outside the project root fails
  - a command that attempts a sensitive home-path read fails
  - timeout still terminates the wrapped child
  - abort still terminates the wrapped child

### Phase 1c — integrate `session/prompt.ts`

Goal:
sandbox the session-command execution path on macOS when enabled.

Steps:

1. route the final shell argv through the wrapper
2. simplify shell startup in sandbox mode if needed
3. do not grant broad home-directory reads to preserve rc loading
4. test command output streaming and abort behavior

Exit criteria:

- session command execution works in sandbox mode for allowed operations
- denied operations fail cleanly
- no broad `$HOME` policy expansion was added to preserve shell rc loading

QA for this phase:

- add focused coverage in either:
  - `packages/opencode/test/session/prompt.test.ts`, or
  - a new `packages/opencode/test/session/prompt-sandbox.test.ts`
- from `packages/opencode`, run:
  - `bun test --timeout 30000 test/session/prompt.test.ts`
    if the existing file is extended, or
  - `bun test --timeout 30000 test/session/prompt-sandbox.test.ts`
    if a dedicated file is added
- expected result:
  - an allowed command still streams output correctly
  - a denied filesystem action fails cleanly
  - rc-file behavior in sandbox mode is deterministic and documented
  - no test requires broad `$HOME` reads to pass

### Phase 1d — docs and release guardrails

Goal:
ship accurate operator-facing documentation.

Steps:

1. update `SECURITY.md`
2. document opt-in enablement
3. document exclusions:
   PTY,
   MCP,
   LSP,
   non-macOS
4. document how sandbox denials should be interpreted

Exit criteria:

- docs match actual coverage
- no overclaiming remains

QA for this phase:

- from the repo root, run:
  `grep -n "non-interactive shell commands\|PTY\|MCP\|LSP\|non-macOS" SECURITY.md`
- expected result:
  - `SECURITY.md` explicitly states macOS-only,
    opt-in,
    non-interactive shell-command coverage
  - `SECURITY.md` explicitly names PTY,
    MCP,
    LSP,
    and non-macOS as exclusions
  - no section implies that all local process execution is sandboxed

## Validation plan

### Unit tests

- profile generation for default-deny policy
- wrapper argv generation on darwin
- no-op wrapper behavior on non-darwin
- config parsing for `experimental.sandbox`

### macOS integration tests

These must run on a macOS host.

#### Core command behavior

1. allowed read inside project root succeeds
2. allowed write inside project root succeeds
3. write outside project root fails
4. read of `~/.ssh` fails
5. outbound HTTP request fails
6. Unix socket access fails

#### Control flow behavior

7. timeout still kills the wrapped process
8. abort still kills the wrapped process
9. stderr and stdout still stream correctly

#### Product behavior

10. sandbox disabled => current behavior preserved
11. non-darwin => current behavior preserved
12. permission allow does not override sandbox deny

### Manual verification

Before updating `SECURITY.md`:

1. build the darwin binary with the existing Bun compile pipeline
2. run a smoke test using the compiled binary,
   not just source mode
3. verify that the wrapper still works there
4. inspect failure output for usability

## Risks and sharp edges

### `sandbox-exec` deprecation

This is a real risk.
The current evidence still points to Seatbelt via `sandbox-exec` as the practical macOS path,
and Codex plus Claude Code both rely on Seatbelt today.
Still,
the implementation should document this as a phase-1 compromise,
not a forever-stable API choice.

### Shell startup behavior drift

`session/prompt.ts` currently sources user shell rc files.
Sandbox mode likely cannot preserve that safely.
Expect behavioral differences there.
Prefer deterministic execution over expansive read permissions.

### Hidden path dependencies

Toolchains may need read access to paths not obvious from the first pass,
especially Homebrew and Xcode-related locations.
This is exactly why the feature should ship opt-in first.

### Timeout and kill semantics through the wrapper

The wrapper adds another process layer.
Abort and timeout behavior must be revalidated,
not assumed.

### False security if scope is described too broadly

If documentation or release notes imply that all local process execution is sandboxed,
that will be incorrect.
Phase 1 is intentionally narrower.

## Open questions

1. Should the session-command path in sandbox mode skip rc-file sourcing entirely,
   or allow a small explicit set of startup files?
2. Which read-only system paths are actually required on Apple Silicon versus Intel Macs?
3. Does any in-scope workflow require loopback access in phase 1,
   or can loopback stay denied?
4. Is an explicit unsandboxed retry path needed in phase 1,
   or can it wait until phase 2?
5. Should MCP sandboxing be the next follow-up after phase 1,
   given its risk profile?

## Pickup checklist for the next agent

1. Read this file fully before touching code.
2. Re-read these repo files before planning edits:
   - `packages/opencode/src/tool/bash.ts`
   - `packages/opencode/src/session/prompt.ts`
   - `packages/opencode/src/config/config.ts`
   - `packages/opencode/src/permission/index.ts`
   - `packages/opencode/src/shell/shell.ts`
3. Start with Phase 0 proof work.
4. Do **not** start by wiring `util/process.ts` or `cross-spawn-spawner.ts` broadly.
5. Keep phase-1 implementation limited to `bash.ts` and `session/prompt.ts` unless the proof work changes scope explicitly.
6. Do **not** allow broad `$HOME` reads.
7. Do **not** leave Unix sockets open while claiming network deny.
8. Do **not** update `SECURITY.md` until the macOS validation matrix passes.

## Suggested first implementation sequence

1. prove `sandbox-exec -p` works correctly with the Bun-compiled darwin binary
2. add sandbox config and env-flag parsing
3. add `sandbox/policy.ts`
4. add `sandbox/spawn.ts`
5. wire `bash.ts`
6. validate
7. wire `session/prompt.ts`
8. validate again
9. update docs

That sequence minimizes the chance of broad regressions,
and it keeps the first shipped claim narrow and accurate.
