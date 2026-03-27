# macOS Command Sandboxing Phase 3: Presets and Runtime

## Status

This is a handoff plan for phase 3 of macOS command sandboxing.
No implementation work is included.
Another engineer MUST be able to implement phase 3 from this plan without redoing discovery.

## Entry gate

Phase 3 builds on phase 2 as its baseline.
Phase 2 MUST land before phase 3 work begins.

Phase 2 delivers:

- PTY interactive shell sandboxing via `bun-pty` + `sandbox-exec`
- `workspace-write` and `read-only` sandbox modes
- Excluded-command pre-spawn blocking
- `fail_if_unavailable` hard-fail behavior
- `allow_unsandboxed_retry` runtime path with distinct permission key
- Coverage of `bash.ts`, `session/prompt.ts`, and `pty/index.ts`

Phase 3 MUST NOT overclaim coverage of any spawn surface that phase 2 did not ship.
If phase 2 has not landed when this plan is picked up,
the implementer MUST either wait or explicitly scope down to phase-1 coverage only (bash tool and session command, no PTY).

---

## Objective

Add Codex-style approval and sandbox presets as a first-class configuration surface,
introduce a small shared spawn-policy helper for sandbox resolution,
extend sandbox coverage to LSP runtime launches,
and harden workspace-root protection with Codex-inspired protected-path behavior.

Phase 3 is a **preset-and-opt-in-runtime** phase.
It is NOT a blanket shared-spawn-centralization phase.

---

## Non-goals

Phase 3 MUST NOT:

1. **Sandbox MCP local server launches** (`mcp/index.ts`).
   MCP processes run operator-configured commands with their own trust model.
   `connectLocal()` in `mcp/index.ts` (line 380) passes the command directly to `StdioClientTransport`.
   Sandboxing that path requires MCP-specific policy design — a separate workstream.

2. **Wire `util/process.ts` or `cross-spawn-spawner.ts` through the sandbox automatically.**
   These are shared spawn utilities used by LSP servers, formatters, `BunProc`, and internal tooling.
   Broadly wiring them would silently sandbox non-agent processes.
   Phase 3 wraps LSP launch specifically, not the general-purpose spawn layers.

3. **Implement domain-based or proxy-mediated network controls.**
   Claude Code's localhost-proxy model is substantial infrastructure.
   Phase 3 keeps the current posture: network denied by default, optionally allowed via policy or per-preset override.

4. **Support Linux or Windows sandboxing.**
   macOS Seatbelt only.

5. **Claim full Codex parity.**
   Phase 3 closes the gap on presets and protected roots.
   It does not replicate Codex's `danger-full-access` mode, automatic worktree discovery, or full approval-policy matrix.

6. **Move sandbox config out of `experimental`.**
   The preset surface is new and needs real-world feedback before promotion.

---

## Parity targets

### What Codex documents

| Concept                                  | Codex behavior                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `sandbox_mode`                           | `read-only`, `workspace-write`, `danger-full-access`                                        |
| `approval_policy`                        | Separate layer from sandbox; controls when the agent must ask                               |
| `profiles.<name>`                        | Named preset profiles composing sandbox + approval                                          |
| `sandbox_workspace_write.writable_roots` | Explicit writable path set                                                                  |
| `sandbox_workspace_write.network_access` | Per-mode network toggle                                                                     |
| Protected roots inside writable roots    | `.git`, resolved gitdir, `.agents`, `.codex` are protected even when the parent is writable |

### What phase 3 targets

| Capability                                      | Codex                       | Phase 3 target                                   |
| ----------------------------------------------- | --------------------------- | ------------------------------------------------ |
| Named presets composing sandbox + permission    | `profiles.<name>`           | Yes — `experimental.sandbox.preset`              |
| Protected roots inside writable workspace       | `.git`, `.agents`, `.codex` | Yes — `.git`, resolved gitdir, `.opencode`       |
| Per-preset network toggle                       | `network_access` per mode   | Yes                                              |
| Approval policy as independent layer            | `approval_policy`           | Partial — maps to existing `permission` rulesets |
| `danger-full-access` mode                       | Supported                   | No — too risky for opt-in experimental           |
| Automatic worktree discovery for writable roots | Automatic                   | No — explicit only                               |
| LSP runtime sandboxing                          | N/A                         | Yes — `lsp/launch.ts`                            |
| Shared spawn-policy helper                      | N/A                         | Yes — `SandboxRuntime` / `SpawnPlan`             |

---

## Concrete files and modules

### New modules

#### `packages/opencode/src/sandbox/preset.ts`

Responsible for resolving a named preset into concrete sandbox and permission configuration.

A preset is a named bundle of:

- sandbox mode (`workspace-write`, `read-only`)
- network access toggle
- protected roots list
- permission ruleset overlay
- optional extra read/write roots

Suggested shape:

```ts
export namespace SandboxPreset {
  export interface Def {
    mode: "workspace-write" | "read-only"
    network: boolean
    protected_roots: string[]
    permission: Permission.Ruleset
    extra_read_roots?: string[]
    extra_write_roots?: string[]
  }

  export function resolve(name: string, overrides?: Partial<Def>): Def
  export function builtins(): Record<string, Def>
}
```

Built-in presets:

| Name      | Mode              | Network | Protected roots                      | Permission overlay       |
| --------- | ----------------- | ------- | ------------------------------------ | ------------------------ |
| `default` | `workspace-write` | `false` | `.git`, resolved gitdir, `.opencode` | none                     |
| `strict`  | `read-only`       | `false` | `.git`, resolved gitdir, `.opencode` | `bash: ask`, `edit: ask` |
| `network` | `workspace-write` | `true`  | `.git`, resolved gitdir, `.opencode` | none                     |

Operators MAY define custom presets under `experimental.sandbox.presets` in config.
Built-in presets MUST NOT be overridable by user config — they serve as known-good baselines.
Custom presets extend the set; they do not replace built-ins.

#### `packages/opencode/src/sandbox/runtime.ts`

A small shared spawn-policy helper that consolidates sandbox resolution logic.
This replaces the pattern of each call site independently calling `SandboxSpawn.resolve()` + `SandboxSpawn.wrap()`.

Suggested shape:

```ts
export namespace SandboxRuntime {
  export interface SpawnPlan {
    active: boolean
    file: string
    args: string[]
    env?: Record<string, string>
    diag: SandboxSpawn.Diag
  }

  export function plan(input: {
    file: string
    args: string[]
    cwd: string
    project_root: string
    worktree_root: string
    preset?: string
  }): SpawnPlan
}
```

This helper:

- Reads the active preset (from config or explicit parameter)
- Resolves protected roots and merges them into deny rules
- Calls `SandboxSpawn.plan()` and `SandboxSpawn.wrap()` internally
- Returns a ready-to-use `SpawnPlan` with final `file` + `args`
- Remains a pure data transformer — no side effects, no spawning

Call sites (`bash.ts`, `session/prompt.ts`, `pty/index.ts`, `lsp/launch.ts`) switch from direct `SandboxSpawn` calls to `SandboxRuntime.plan()`.
This is a refactor of existing wiring, not new coverage.

### Files to change

#### `packages/opencode/src/sandbox/policy.ts`

Current state:

- `SandboxPolicy.build()` generates SBPL from `Input` with read roots, write roots, deny roots, network, Unix sockets
- `secret` array holds credential-path deny list
- No awareness of protected workspace roots

Planned changes:

- Accept `protected_roots` in `Input`.
  These are paths inside writable roots that MUST be denied for writes.
  They are added to the deny list after write-root expansion.
- The SBPL generation MUST emit deny rules for protected roots _after_ the write-allow rules,
  so that Seatbelt's last-match-wins evaluation denies writes to protected paths even inside writable directories.
- Accept `mode` in `Input` to support `read-only` moving project/worktree to read roots (phase 2 may already have this; if so, no change needed).

#### `packages/opencode/src/sandbox/spawn.ts`

Current state (after phase 2):

- `resolve()` reads config, detects platform, builds plan
- `plan()` validates roots, builds policy, returns active/inactive
- `wrap()` produces `{ file: "sandbox-exec", args: ["-p", profile, ...] }`
- Mode, excluded commands, fail-if-unavailable, and unsandboxed retry are wired

Planned changes:

- Accept an optional `preset` name in `ResolveInput`.
  When provided, resolve the preset via `SandboxPreset.resolve()` and merge its settings before building the plan.
- Preset settings MUST be overridable by explicit `experimental.sandbox.*` fields.
  Priority order (highest wins): explicit config fields > preset defaults > hardcoded defaults.
- When a preset specifies `network: true`, set `allow_network: true` in the policy input.
- When a preset specifies `protected_roots`, pass them through to `SandboxPolicy.build()`.

#### `packages/opencode/src/config/config.ts`

Current sandbox schema (after phase 2):

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

Planned evolution:

```ts
sandbox: z.object({
  enabled: z.boolean().optional(),
  preset: z.string().optional(),
  mode: z.enum(["workspace-write", "read-only"]).optional(),
  network: z.boolean().optional(),
  protected_roots: z.array(z.string()).optional(),
  extra_read_roots: z.array(z.string()).optional(),
  extra_write_roots: z.array(z.string()).optional(),
  extra_deny_paths: z.array(z.string()).optional(),
  excluded_commands: z.array(z.string()).optional(),
  allow_unsandboxed_retry: z.boolean().optional(),
  fail_if_unavailable: z.boolean().optional(),
  presets: z
    .record(
      z.string(),
      z.object({
        mode: z.enum(["workspace-write", "read-only"]).optional(),
        network: z.boolean().optional(),
        protected_roots: z.array(z.string()).optional(),
        extra_read_roots: z.array(z.string()).optional(),
        extra_write_roots: z.array(z.string()).optional(),
        permission: Permission.optional(),
      }),
    )
    .optional(),
}).optional()
```

Field semantics:

- `preset`: name of the active preset.
  When set, the preset's defaults apply.
  Explicit sibling fields (`mode`, `network`, etc.) override the preset's defaults.
- `network`: controls whether the sandbox allows outbound network.
  Default `false`.
  Overrides the preset's `network` setting.
- `protected_roots`: workspace-relative paths that MUST be write-denied even inside writable roots.
  Defaults to `[".git", ".opencode"]` when any preset is active.
  Operators MAY add custom protected roots (e.g., `.env`, `secrets/`).
- `presets`: operator-defined named presets.
  These extend the built-in set.
  A custom preset with the same name as a built-in MUST be rejected at config parse time with a clear error.

#### `packages/opencode/src/lsp/launch.ts`

Current state:

- `spawn()` delegates to `Process.spawn()` from `util/process.ts`
- Passes `stdin: "pipe"`, `stdout: "pipe"`, `stderr: "pipe"`
- No sandbox awareness

Planned change:

- Before spawning, call `SandboxRuntime.plan()` to resolve a spawn plan.
- When sandbox is active, replace the `cmd` + `args` with the wrapped version from the plan.
- Pass the wrapped command to `Process.spawn()`.
- LSP servers need read access to the project root and standard system paths.
  They SHOULD NOT need write access outside `/tmp` and explicitly configured write roots.
- The sandbox mode for LSP launches SHOULD default to `read-only` regardless of the active preset's mode.
  LSP servers are infrastructure; they SHOULD NOT write to the workspace.

Sharp edges:

- LSP servers often need to read the entire project tree plus globally installed toolchains.
  The read-root set MUST include Homebrew paths (`/opt/homebrew`, `/usr/local`) and any Nix store paths configured in `extra_read_roots`.
- Some LSP servers write to cache directories under `$HOME` (e.g., `~/.cache/typescript`).
  Phase 3 SHOULD NOT grant broad `$HOME` writes.
  If a specific LSP fails, the operator SHOULD add the cache path to `extra_write_roots`.
- `lsp/server.ts` manages LSP server lifecycle and calls `spawn()` from `lsp/launch.ts`.
  The sandbox integration is in `launch.ts`; `server.ts` does not need changes.

#### `packages/opencode/src/lsp/server.ts`

No changes planned.
`server.ts` calls `spawn()` from `launch.ts`.
The sandbox wrapping happens inside `launch.ts`.

#### `packages/opencode/src/file/protected.ts`

Current state:

- `Protected.names()` returns macOS TCC-protected directory basenames
- `Protected.paths()` returns absolute paths that should never be watched or scanned
- Used for file watcher exclusion, not sandbox policy

Planned change:

- Add a `Protected.workspace()` export that returns the default protected roots for sandbox policy:
  `[".git", ".opencode"]`.
- Add a `Protected.resolve(project_root: string)` that resolves `.git` to the actual gitdir
  (handles worktrees where `.git` is a file pointing elsewhere)
  and returns absolute paths.
- `SandboxPreset` and `SandboxRuntime` call `Protected.resolve()` to build the deny list for protected workspace roots.

#### `packages/opencode/src/tool/bash.ts`

Current state (after phase 2):

- Wired through `SandboxSpawn.resolve()` and `SandboxSpawn.wrap()`
- Has excluded-command checking and unsandboxed retry

Planned change:

- Switch from direct `SandboxSpawn` calls to `SandboxRuntime.plan()`.
- The preset name flows from config through the runtime helper.
- No behavioral change beyond the refactor.

#### `packages/opencode/src/session/prompt.ts`

Same refactor as `bash.ts`: switch to `SandboxRuntime.plan()`.

#### `packages/opencode/src/pty/index.ts`

Same refactor as `bash.ts`: switch to `SandboxRuntime.plan()`.

#### `packages/opencode/src/agent/agent.ts`

Current state:

- Builds per-agent permission rulesets via `Permission.merge()` of defaults, agent-specific config, and user config
- No awareness of sandbox presets

Planned change:

- When a sandbox preset specifies a `permission` overlay,
  merge that overlay into the agent's ruleset at the correct priority.
- Priority order (lowest to highest):
  1. Hardcoded defaults
  2. Preset permission overlay
  3. Agent-specific config (`cfg.agent.<name>.permission`)
  4. Top-level user config (`cfg.permission`)
- This preserves the existing merge behavior.
  The preset overlay sits between defaults and explicit user config.

#### `packages/opencode/src/permission/index.ts`

No structural change required.
`Permission.merge()` and `Permission.fromConfig()` already support arbitrary rulesets.
The preset's permission overlay is just another ruleset passed to `merge()`.

#### `packages/opencode/src/permission/evaluate.ts`

No change.
Last-match-wins evaluation is already correct for the preset overlay merge order.

### Files explicitly NOT changed in phase 3

| File                                                  | Reason                                     |
| ----------------------------------------------------- | ------------------------------------------ |
| `packages/opencode/src/util/process.ts`               | Shared spawn utility, not agent-visible    |
| `packages/opencode/src/effect/cross-spawn-spawner.ts` | Effect-layer spawn, used by infrastructure |
| `packages/opencode/src/mcp/index.ts`                  | MCP server launch, separate trust model    |

---

## Preset model

### Resolution order

When sandbox is enabled:

1. Read `experimental.sandbox.preset` from config (e.g., `"default"`, `"strict"`, `"network"`, or a custom name).
2. Look up the preset definition: first in built-ins, then in `experimental.sandbox.presets`.
3. Merge the preset's defaults with explicit config overrides.
   Explicit fields always win.
4. The merged result feeds into `SandboxRuntime.plan()`.

If no preset is specified but sandbox is enabled,
the `"default"` preset applies implicitly.

### Relationship to existing config

The `preset` field is sugar.
Every field a preset sets can be set directly.
Operators who prefer granular control MAY ignore presets entirely and set `mode`, `network`, `protected_roots`, etc. directly.

The raw `permission` and `experimental.sandbox.*` fields remain as explicit overrides.
Presets do not replace them; they provide convenient defaults.

### Example configs

Minimal opt-in with default preset:

```json
{
  "experimental": {
    "sandbox": {
      "enabled": true
    }
  }
}
```

Strict preset with custom protected root:

```json
{
  "experimental": {
    "sandbox": {
      "enabled": true,
      "preset": "strict",
      "protected_roots": [".git", ".opencode", ".env"]
    }
  }
}
```

Custom preset definition:

```json
{
  "experimental": {
    "sandbox": {
      "enabled": true,
      "preset": "ci",
      "presets": {
        "ci": {
          "mode": "workspace-write",
          "network": true,
          "protected_roots": [".git", ".opencode"],
          "permission": {
            "bash": "allow",
            "edit": "allow"
          }
        }
      }
    }
  }
}
```

Preset with explicit override:

```json
{
  "experimental": {
    "sandbox": {
      "enabled": true,
      "preset": "default",
      "network": true
    }
  }
}
```

Here `"default"` preset has `network: false`,
but the explicit `"network": true` overrides it.

---

## Protected-root model

### Codex behavior

Codex protects certain paths inside writable roots:

- `.git` (and resolved gitdir for worktrees)
- `.agents`
- `.codex`

These paths are write-denied even when the parent directory is writable.
This prevents the agent from modifying version control state or its own configuration.

### Phase 3 behavior

Default protected roots when sandbox is active: `.git` and `.opencode`.

Resolution:

1. `Protected.resolve(project_root)` resolves `.git` to the actual gitdir.
   For standard repos, this is `<project_root>/.git`.
   For worktrees, `.git` is a file whose content points to the real gitdir (e.g., `../../.git/worktrees/foo`).
   Both paths MUST be protected.
2. `.opencode` resolves to `<project_root>/.opencode`.
3. Operator-configured `protected_roots` are resolved relative to the project root.

SBPL implementation:

The deny rules for protected roots MUST appear after the write-allow rules in the profile.
Seatbelt evaluates rules in order; later rules take precedence.
This ensures that `(deny file-write* (subpath "<protected>"))` overrides `(allow file-write* (subpath "<project_root>"))`.

### Workspace boundary

Phase 3 MUST NOT treat all discovered worktrees as automatically writable.
Only the explicitly configured project root and worktree root are writable.
Additional writable paths require explicit `extra_write_roots` configuration.

---

## LSP runtime coverage

### Scope

Phase 3 extends sandbox coverage to LSP server process launches via `lsp/launch.ts`.
This is the only new spawn surface covered in phase 3.

### Why LSP

LSP servers are long-running processes spawned by opencode to provide language intelligence.
They read the entire project tree and execute with full user privileges.
A compromised or misconfigured LSP server can read credentials, exfiltrate code, or modify files.

Sandboxing LSP servers with a read-only policy and restricted network
reduces the blast radius of language server vulnerabilities.

### Why not MCP

MCP local servers (`mcp/index.ts` line 380) use `StdioClientTransport` which manages its own process lifecycle.
The transport creates the child process internally; opencode does not call `spawn()` directly.
Sandboxing MCP requires either patching the SDK transport or wrapping the command before passing it to the transport.
This is a separate design problem and SHOULD be a phase 4 workstream.

### LSP sandbox policy

- Mode: `read-only` (regardless of the active preset's mode)
- Read roots: project root, worktree root, standard system paths, Homebrew paths, configured `extra_read_roots`
- Write roots: `/tmp`, `/private/tmp` only (LSP servers SHOULD NOT need to write to the workspace)
- Network: denied by default (LSP servers SHOULD NOT need network access)
- Protected roots: not applicable (project root is read-only for LSP)

If a specific LSP server needs write access (e.g., to a cache directory),
the operator SHOULD add the path to `extra_write_roots`.

---

## Validation matrix

### Unit tests

| Test                                                                              | Location                       |
| --------------------------------------------------------------------------------- | ------------------------------ |
| Preset resolution for built-in names                                              | `test/sandbox/preset.test.ts`  |
| Custom preset definition and lookup                                               | `test/sandbox/preset.test.ts`  |
| Preset override by explicit config fields                                         | `test/sandbox/preset.test.ts`  |
| Built-in preset name collision rejection                                          | `test/sandbox/preset.test.ts`  |
| Protected-root resolution for standard repo                                       | `test/sandbox/policy.test.ts`  |
| Protected-root resolution for worktree                                            | `test/sandbox/policy.test.ts`  |
| SBPL deny-after-allow ordering for protected roots                                | `test/sandbox/policy.test.ts`  |
| `SandboxRuntime.plan()` returns correct `SpawnPlan`                               | `test/sandbox/runtime.test.ts` |
| `SandboxRuntime.plan()` applies preset defaults                                   | `test/sandbox/runtime.test.ts` |
| `SandboxRuntime.plan()` respects explicit overrides                               | `test/sandbox/runtime.test.ts` |
| Config parsing for new fields (`preset`, `network`, `protected_roots`, `presets`) | `test/config/`                 |
| Preset permission overlay merge order in `agent.ts`                               | `test/agent/`                  |

### macOS integration tests

| #   | Test                                                                   | Expected                       |
| --- | ---------------------------------------------------------------------- | ------------------------------ |
| 1   | Default preset active, write to project file                           | Succeeds                       |
| 2   | Default preset active, write to `.git/config`                          | Fails with Seatbelt denial     |
| 3   | Default preset active, write to `.opencode/state.json`                 | Fails with Seatbelt denial     |
| 4   | Strict preset active, write to project file                            | Fails (read-only mode)         |
| 5   | Strict preset active, read project file                                | Succeeds                       |
| 6   | Network preset active, `curl https://example.com`                      | Succeeds                       |
| 7   | Default preset active, `curl https://example.com`                      | Fails (network denied)         |
| 8   | Custom preset with `network: true`, explicit `network: false` override | Network denied (explicit wins) |
| 9   | LSP server launch with sandbox enabled, reads project file             | Succeeds                       |
| 10  | LSP server launch with sandbox enabled, writes to project root         | Fails                          |
| 11  | LSP server launch with sandbox enabled, writes to `/tmp`               | Succeeds                       |
| 12  | LSP server launch with sandbox enabled, outbound HTTP                  | Fails                          |
| 13  | `SandboxRuntime.plan()` used from `bash.ts`                            | Same behavior as pre-refactor  |
| 14  | `SandboxRuntime.plan()` used from `pty/index.ts`                       | Same behavior as pre-refactor  |
| 15  | Worktree `.git` file resolution, write to resolved gitdir              | Fails                          |

### Manual verification

Before updating docs:

1. Build the darwin binary with the Bun compile pipeline.
2. Enable sandbox with `"preset": "default"` and run common bash tool commands.
3. Verify `.git/config` write is denied while project-file write succeeds.
4. Start an LSP server (e.g., TypeScript) with sandbox enabled and verify diagnostics work.
5. Verify LSP server cannot write to the project root.
6. Test with a git worktree to confirm `.git` file resolution protects the real gitdir.

---

## Sequencing

### Phase 3a — preset infrastructure

Goal: land `sandbox/preset.ts` with built-in presets and config parsing.

Steps:

1. Add `preset`, `network`, `protected_roots`, and `presets` to the config schema.
2. Implement `SandboxPreset.resolve()` and `SandboxPreset.builtins()`.
3. Add config-time validation rejecting custom presets that collide with built-in names.
4. Add unit tests for preset resolution, override semantics, and collision rejection.

Exit criteria:

- Config parses correctly with new fields
- Preset resolution returns expected defaults
- Explicit fields override preset defaults
- Feature remains behavioral no-op until wired into spawn path

QA:

- From `packages/opencode`, run `bun run typecheck`
- From `packages/opencode`, run `bun test --timeout 30000 test/sandbox/preset.test.ts`

### Phase 3b — protected roots

Goal: implement protected-root resolution and SBPL deny-after-allow ordering.

Steps:

1. Add `Protected.workspace()` and `Protected.resolve()` to `file/protected.ts`.
2. Add `protected_roots` to `SandboxPolicy.Input`.
3. In `SandboxPolicy.build()`, emit deny rules for protected roots after write-allow rules.
4. Add unit tests verifying SBPL output order and worktree `.git` resolution.

Exit criteria:

- `.git` and `.opencode` are write-denied inside writable project root
- Worktree gitdir is correctly resolved and protected
- SBPL deny rules appear after write-allow rules

QA:

- From `packages/opencode`, run `bun run typecheck`
- From `packages/opencode`, run `bun test --timeout 30000 test/sandbox/policy.test.ts`
- macOS integration: `touch .git/test` inside sandbox MUST fail

### Phase 3c — `SandboxRuntime` helper

Goal: consolidate sandbox resolution into `SandboxRuntime.plan()`.

Steps:

1. Implement `sandbox/runtime.ts` with `SandboxRuntime.plan()`.
2. Refactor `bash.ts` to use `SandboxRuntime.plan()` instead of direct `SandboxSpawn` calls.
3. Refactor `session/prompt.ts` the same way.
4. Refactor `pty/index.ts` the same way.
5. Verify all existing sandbox behavior is preserved through the refactor.

Exit criteria:

- All three existing call sites use `SandboxRuntime.plan()`
- No behavioral change
- Existing tests pass without modification

QA:

- From `packages/opencode`, run `bun run typecheck`
- From `packages/opencode`, run `bun test --timeout 30000` for all existing sandbox tests
- Manual smoke test: enable sandbox, run bash commands, verify same behavior as before

### Phase 3d — preset permission overlay

Goal: merge preset permission overlays into agent rulesets.

Steps:

1. In `agent/agent.ts`, when a sandbox preset is active, read its `permission` overlay.
2. Insert the overlay into the `Permission.merge()` chain between defaults and agent-specific config.
3. Add tests verifying the merge order.

Exit criteria:

- Strict preset's `bash: ask` overlay takes effect for the build agent
- Explicit user permission config overrides the preset overlay
- Agents without permission config inherit the preset overlay

QA:

- From `packages/opencode`, run `bun run typecheck`
- Add a dedicated test file at `packages/opencode/test/sandbox/preset-permission.test.ts`.
- From `packages/opencode`, run:
  `bun test --timeout 30000 test/sandbox/preset-permission.test.ts`
- Test case 1 — preset overlay applies when no agent or user override exists:
  - Configure the `strict` preset (which sets `bash: ask`).
  - Resolve the `build` agent's permission ruleset.
  - Evaluate `Permission.evaluate("bash", "echo hello", ruleset)`.
  - Expected result: action is `"ask"`.
- Test case 2 — agent-specific config overrides the preset overlay:
  - Configure the `strict` preset (`bash: ask`).
  - Configure `agent.build.permission` with `bash: allow`.
  - Resolve the `build` agent's permission ruleset.
  - Evaluate `Permission.evaluate("bash", "echo hello", ruleset)`.
  - Expected result: action is `"allow"` (agent config wins over preset overlay).
- Test case 3 — top-level user config overrides both preset and agent config:
  - Configure the `strict` preset (`bash: ask`).
  - Configure `agent.build.permission` with `bash: allow`.
  - Configure top-level `permission` with `bash: deny`.
  - Resolve the `build` agent's permission ruleset.
  - Evaluate `Permission.evaluate("bash", "echo hello", ruleset)`.
  - Expected result: action is `"deny"` (top-level user config wins over both).
- Test case 4 — agent without explicit permission inherits preset overlay:
  - Configure the `strict` preset (`bash: ask`, `edit: ask`).
  - Do NOT set any `agent.general.permission`.
  - Resolve the `general` agent's permission ruleset.
  - Evaluate `Permission.evaluate("bash", "ls", ruleset)`.
  - Expected result: action is `"ask"` (preset overlay is inherited).
- Test case 5 — no preset active, existing behavior preserved:
  - Do NOT set a `preset` or enable sandbox.
  - Resolve the `build` agent's permission ruleset.
  - Evaluate `Permission.evaluate("bash", "echo hello", ruleset)`.
  - Expected result: action matches the existing phase-2 default (no preset influence).

### Phase 3e — LSP runtime sandboxing

Goal: sandbox LSP server launches on macOS when sandbox is enabled.

Steps:

1. In `lsp/launch.ts`, call `SandboxRuntime.plan()` before spawning.
2. When active, replace `cmd` + `args` with the wrapped version.
3. Force `read-only` mode for LSP launches regardless of preset.
4. Validate that LSP servers can still read the project tree and provide diagnostics.
5. Validate that LSP servers cannot write to the project root.

Exit criteria:

- LSP servers start correctly inside the sandbox
- Language diagnostics work (TypeScript, etc.)
- Write attempts to the project root fail
- Outbound network is denied

QA:

- From `packages/opencode`, run `bun run typecheck`
- Manual verification: enable sandbox, open a TypeScript file, verify diagnostics appear
- Manual verification: monitor sandbox denials to ensure no unexpected reads are blocked
- Add integration tests in `packages/opencode/test/lsp/` if testable without a running LSP server

### Phase 3f — docs

Goal: ship accurate documentation for phase 3 capabilities.

Steps:

1. Update `SECURITY.md` to reflect preset support and LSP coverage.
2. Document preset model: built-ins, custom definitions, override semantics.
3. Document protected-root behavior.
4. Document LSP sandboxing and its limitations.
5. Document exclusions: MCP, internal spawn layers, domain-mediated network, non-macOS.

Exit criteria:

- Docs match actual coverage
- No overclaiming

QA:

- From the repo root, run:
  `grep -n "preset\|protected.root\|LSP\|MCP\|non-macOS" SECURITY.md`
- Expected: each new capability is documented with scope and limitations
- No sentence implies all process execution is sandboxed

---

## Rollout plan

1. Ship phase 3a (preset infrastructure) behind the existing `experimental.sandbox.enabled` flag.
   No new flag required.
2. Ship phase 3b (protected roots) alongside 3a.
   Default protected roots activate when sandbox is enabled.
3. Ship phase 3c (runtime helper refactor) as a no-behavioral-change refactor.
4. Ship phase 3d (preset permission overlay) with presets active only when `preset` is explicitly set.
5. Ship phase 3e (LSP sandboxing) behind the existing `enabled` flag.
   LSP sandboxing activates when sandbox is enabled; no additional opt-in.
6. Ship phase 3f (docs) only after manual verification of the full validation matrix.

Each sub-phase MAY ship independently.
Phase 3c SHOULD land before 3d and 3e because they depend on `SandboxRuntime.plan()`.
Phases 3a and 3b have no ordering dependency on each other.

---

## Risks and sharp edges

### SBPL rule ordering for protected roots

Seatbelt uses last-match-wins for conflicting rules.
If deny rules for `.git` appear before the write-allow rule for the project root,
the allow rule will override the deny.
The implementation MUST emit deny rules after allow rules.

Mitigation: add a dedicated unit test that verifies the SBPL output order.

### LSP server compatibility

LSP servers may read paths not obvious from the first pass —
global npm modules, toolchain caches, language-specific state directories.
A too-restrictive read policy will break language intelligence silently.

Mitigation: ship LSP sandboxing behind the existing experimental flag.
Monitor sandbox denials (visible in macOS Console.app) during early testing.
Document the `extra_read_roots` escape hatch prominently.

### Preset name collisions

If a custom preset shares a name with a built-in,
the config parser MUST reject it.
Silent override of built-in presets would break safety guarantees.

Mitigation: validate at config parse time and emit a clear error message.

### `sandbox-exec` deprecation

Inherited from phases 1 and 2.
Apple has not removed `sandbox-exec` but has deprecated the Seatbelt API.
Both Codex and Claude Code still rely on it.

### Worktree gitdir resolution

Git worktrees store a `.git` file (not directory) that contains the path to the real gitdir.
The resolver must handle both cases and protect both the `.git` entry and the resolved target.

Mitigation: `Protected.resolve()` reads `.git` as a file, parses the `gitdir:` line, and resolves it.
Add unit tests for both standard repos and worktrees.

### MCP `StdioClientTransport` ownership

The MCP SDK's `StdioClientTransport` owns the child process lifecycle.
Wrapping the command before passing it to the transport is possible but fragile.
Phase 3 explicitly defers this.

---

## Open questions

1. Should the `"default"` preset activate implicitly when `enabled: true` and no `preset` is specified,
   or should preset activation require an explicit `"preset": "default"` field?
   Implicit activation is more ergonomic; explicit is safer for backward compatibility.

2. Should LSP sandbox denials be surfaced to the user in the TUI,
   or only logged?
   Surfacing them helps debugging but may be noisy.

3. Should custom presets be allowed to set `fail_if_unavailable` and `allow_unsandboxed_retry`,
   or should those remain top-level-only fields?

4. What is the right default for `protected_roots` when no preset is active but sandbox is enabled?
   Options: empty (backward compat with phase 2), or `[".git", ".opencode"]` (safer default).

5. Should phase 3 add a `"permissive"` built-in preset that allows network and has no extra protected roots,
   as a stepping stone toward Codex's `danger-full-access`?
   This would be useful for CI but weakens the safety story.

6. Do any built-in LSP servers (TypeScript, Go, Rust Analyzer, etc.) need write access beyond `/tmp`?
   This needs empirical testing before finalizing the LSP sandbox policy.

---

## Phase-3 product statement

If phase 3 ships successfully,
the correct security statement is:

> On macOS,
> opencode can optionally sandbox agent-issued shell commands from the bash tool, session command path, PTY interactive sessions, and LSP server launches.
> The sandbox supports named presets composing mode, network, and permission settings.
> Workspace-critical paths (`.git`, `.opencode`) are write-protected even inside writable roots.
> Operators can define custom presets and override any preset default with explicit config fields.
> MCP servers,
> internal process utilities,
> domain-mediated network controls,
> and non-macOS platforms are not covered by this phase.

Anything broader than that is inaccurate.

---

## Later phases

Phase 3 intentionally defers the following.

| Item                                       | Why deferred                                       | Likely phase     |
| ------------------------------------------ | -------------------------------------------------- | ---------------- |
| MCP local server sandboxing                | SDK transport owns process lifecycle               | Phase 4          |
| `util/process.ts` auto-sandboxing          | Shared by non-agent code paths                     | Phase 4 or later |
| `cross-spawn-spawner.ts` auto-sandboxing   | Effect-layer spawn, infrastructure                 | Phase 4 or later |
| `danger-full-access` mode                  | Too risky for experimental                         | Phase 4+         |
| Domain/proxy network mediation             | Substantial infrastructure (localhost proxy)       | Phase 5+         |
| Automatic worktree writable-root discovery | Requires safe heuristics for multi-worktree setups | Phase 4          |
| Linux sandboxing                           | Different mechanism (bubblewrap, namespaces)       | Phase 5+         |
| Windows sandboxing                         | Different mechanism entirely                       | Phase 6+         |

---

## Pickup checklist for the next agent

1. Read this file fully before touching code.
2. Read the phase-1 plan at `.sisyphus/plans/macos-command-sandboxing-handoff.md` for historical context.
3. Read the phase-2 plan at `.sisyphus/plans/macos-command-sandboxing-phase-2-parity.md` for the immediate baseline.
4. Verify phase 2 has landed by checking that `pty/index.ts` has sandbox wiring,
   `config.ts` has `mode`, `excluded_commands`, and `fail_if_unavailable` fields,
   and `sandbox/spawn.ts` has mode and excluded-command support.
   If phase 2 has NOT landed, STOP and either wait or scope down to phase-1 coverage.
5. Re-read these repo files before planning edits:
   - `packages/opencode/src/sandbox/policy.ts` (SBPL builder)
   - `packages/opencode/src/sandbox/spawn.ts` (wrapper, plan, resolve)
   - `packages/opencode/src/config/config.ts` (sandbox config, around line 1020)
   - `packages/opencode/src/lsp/launch.ts` (LSP spawn, 21 lines)
   - `packages/opencode/src/lsp/server.ts` (LSP lifecycle, calls `spawn()` from `launch.ts`)
   - `packages/opencode/src/file/protected.ts` (TCC-protected paths)
   - `packages/opencode/src/agent/agent.ts` (permission merge in `InstanceState.make`, around line 80)
   - `packages/opencode/src/permission/index.ts` (`merge()`, `fromConfig()`, `evaluate()`)
   - `packages/opencode/src/permission/evaluate.ts` (last-match-wins rule evaluation)
6. Start with phase 3a and 3b (preset infrastructure + protected roots).
   These can land in parallel.
7. Land phase 3c (runtime helper refactor) before 3d and 3e.
8. Do NOT wire `util/process.ts`, `cross-spawn-spawner.ts`, or `mcp/index.ts`.
9. Do NOT implement `danger-full-access` mode.
10. Do NOT claim domain-mediated network controls.
11. Do NOT treat all discovered worktrees as automatically writable.
12. Do NOT allow custom presets to shadow built-in preset names.
13. Do NOT update `SECURITY.md` until the validation matrix passes.
14. Preserve raw `permission` and `experimental.sandbox.*` as explicit overrides over preset defaults.
