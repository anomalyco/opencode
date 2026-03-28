# Security

## IMPORTANT

We do not accept AI generated security reports. We receive a large number of
these and we absolutely do not have the resources to review them all. If you
submit one that will be an automatic ban from the project.

## Threat Model

### Overview

OpenCode is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

### Sandboxing (macOS only, experimental)

OpenCode can optionally sandbox certain command execution paths on macOS using `sandbox-exec`. This feature is **opt-in**, **experimental**, and **off by default**. It is not available on Linux or Windows.

#### Covered surfaces

| Surface                                                     | Sandbox profile | Excluded-command check | Unsandboxed retry                   |
| ----------------------------------------------------------- | --------------- | ---------------------- | ----------------------------------- |
| **Bash tool** (agent-issued non-interactive commands)       | Yes             | Yes (pre-spawn)        | Yes (`bash:unsandboxed` permission) |
| **Session command path** (user-initiated command execution) | Yes             | Yes (pre-spawn)        | Yes (`bash:unsandboxed` permission) |
| **PTY interactive sessions**                                | Yes             | Initial spawn only     | No                                  |

PTY sessions apply the sandbox profile to the initial process spawn and check `excluded_commands` before spawning. In-band command filtering inside a running PTY session is **not** performed — once a PTY shell is running, commands typed into it are not individually inspected or blocked.

#### Presets

Built-in presets control mode, network, and permission defaults:

| Preset        | Mode              | Network | Notes                                     |
| ------------- | ----------------- | ------- | ----------------------------------------- |
| **`default`** | `workspace-write` | No      | Read system paths, read/write workspace   |
| **`strict`**  | `read-only`       | No      | Writes limited to `/tmp`; bash/edit = ask |
| **`network`** | `workspace-write` | Yes     | Same as default but allows network access |

Custom presets can be defined under `experimental.sandbox.presets` in `opencode.json`. Selecting a preset via the `preset` field resolves the named preset, then any sibling sandbox fields (`mode`, `network`, `protected_roots`, `extra_read_roots`, `extra_write_roots`) override the preset values.

#### Protected roots

Inside writable workspace roots, `.git` and `.opencode` are always write-protected. If the workspace is a git worktree, the resolved gitdir target (read from the `.git` file) is also write-protected. These deny rules are emitted after the write-allow rules in the `sandbox-exec` profile, so they take precedence.

#### Modes

- **`workspace-write`** (default) — the sandboxed process can read system paths and read/write within the project workspace.
- **`read-only`** — the sandboxed process can read, and writes are limited to `/tmp`, `/private/tmp`, and explicitly configured extra write roots.

There is no `danger-full-access` or unrestricted mode. Even the most permissive built-in preset (`network`) still enforces filesystem boundaries and protected roots.

#### Configuration options

All options live under `experimental.sandbox` in `opencode.json`:

- **`preset`** — selects a built-in or custom preset by name. Defaults to `default`.
- **`presets`** — defines custom presets keyed by name. Each preset can specify `mode`, `network`, `protected_roots`, `permission`, `extra_read_roots`, and `extra_write_roots`.
- **`mode`** — overrides the preset mode (`workspace-write` or `read-only`).
- **`network`** — overrides the preset network policy (`true` or `false`).
- **`protected_roots`** — overrides the preset list of write-protected workspace-relative paths (defaults to `.git` and `.opencode`).
- **`extra_read_roots`** — additional absolute paths the sandbox allows reading.
- **`extra_write_roots`** — additional absolute paths the sandbox allows writing.
- **`excluded_commands`** — a pre-spawn deny list of command prefixes. Matched commands are blocked before execution on all covered surfaces.
- **`fail_if_unavailable`** — when `true`, hard-fails activation if sandboxing is enabled but `sandbox-exec` is missing or the platform is unsupported.
- **`extra_deny_paths`** — extends the default set of denied paths (secrets directories like `.ssh`, `.gnupg`, `.aws`, etc.).
- **`allow_unsandboxed_retry`** — when `true`, adds a distinct `bash:unsandboxed` permission-gated retry for the bash tool and session command path only. If a sandboxed command fails due to a sandbox denial, the user is prompted to allow an unsandboxed re-execution. PTY sessions do **not** support unsandboxed retry.

#### Not covered

The following are explicitly **not** sandboxed:

- MCP server processes (local stdio servers and SSE connections)
- Internal spawn utilities (`util/process.ts`, `cross-spawn-spawner.ts`) not routed through the three surfaces above
- Domain/proxy-mediated network controls
- All non-macOS platforms (Linux, Windows, etc.)

The permission system (confirmation prompts before commands, file writes, etc.) remains a UX layer, not a security boundary. A sandbox denial can still block a command that the permission system allowed.

For stronger isolation, run OpenCode inside a Docker container or VM.

### Server Mode

Server mode is opt-in only. When enabled, set `OPENCODE_SERVER_PASSWORD` to require HTTP Basic Auth. Without this, the server runs unauthenticated (with a warning). It is the end user's responsibility to secure the server - any functionality it provides is not a vulnerability.

### Out of Scope

| Category                              | Rationale                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| **Server access when opted-in**       | If you enable server mode, API access is expected behavior                   |
| **Sandbox escapes (uncovered paths)** | MCP servers, non-macOS execution, and in-band PTY commands are not sandboxed |
| **LLM provider data handling**        | Data sent to your configured LLM provider is governed by their policies      |
| **MCP server behavior**               | External MCP servers you configure are outside our trust boundary            |
| **Malicious config files**            | Users control their own config; modifying it is not an attack vector         |

---

# Reporting Security Issues

We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

To report a security issue, please use the GitHub Security Advisory ["Report a Vulnerability"](https://github.com/anomalyco/opencode/security/advisories/new) tab.

The team will send a response indicating the next steps in handling your report. After the initial reply to your report, the security team will keep you informed of the progress towards a fix and full announcement, and may ask for additional information or guidance.

## Escalation

If you do not receive an acknowledgement of your report within 6 business days, you may send an email to security@anoma.ly
