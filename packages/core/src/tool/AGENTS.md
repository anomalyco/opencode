# Core Tool Architecture

This folder owns Core-native tool definition, contribution, effective lookup, and execution. Keep those concerns distinct even though `ToolRegistry` brings them together at runtime.

## Current Architecture

```txt
Public Tool.make      NativeTool value      ApplicationTools      Location built-ins       Location ToolRegistry                        Session runner
        │                     │                     │                      │                         │                                         │
        ├─ construct ─────────▶                     │                      │                         │                                         │
        │                     │                     │                      │                         │                                         │
        │                     ├─ scoped attach ─────▶                      │                         │                                         │
        │                     │                     │                      │                         │                                         │
        │                     │                     │                      ├─ scoped contributions ──▶                                         │
        │                     │                     │                      │                         │                                         │
        │                     │                     ├─ shared current entries ───────────────────────▶                                         │
        │                     │                     │                      │                         │                                         │
        │                     │                     │                      │                         ├─ effective definitions and settlement ──▶
        │                     │                     │                      │                         │                                         │
```

There are three relevant representations:

- `native.ts` defines the plain Core-native executable value exposed publicly as `Tool.make(...)`. It combines an `@opencode-ai/llm` model-facing definition with a Session-aware handler.
- `application-tools.ts` stores process-scoped application contributions. It owns availability and scoped attachment, but it does not execute tools.
- `registry.ts` is the single execution registry. Each Location owns one registry, its built-in contributions, effective precedence, input/output validation, permissions, and settlement.

`ToolRegistry.Entry` is intentionally more powerful than the public native tool value. Internal Location tools may use Core-owned capabilities such as `assertPermission`; embedding applications receive only the narrow public execution context.

## Placement And Layers

- `ApplicationTools.Service` is process-scoped and must be shared by current and future Locations.
- `ToolRegistry.Service` is Location-scoped because built-in handlers close over Location services such as filesystem, permissions, and tool-output storage.
- `LocationServiceMap` constructs fresh Location services while receiving the shared `ApplicationTools.Service` as a dependency.
- `OpenCode.layer` exposes the same shared application-tool service through `opencode.tools.attach(...)`.
- `ToolRegistry.defaultLayer` creates isolated application-tool state. It is suitable for self-contained consumers and tests, but not when attachments must be shared with a separately constructed `LocationServiceMap`.

Do not make `ToolRegistry` process-global. Do not move Location resources into `ApplicationTools`. Do not construct independent `ApplicationTools.layer` instances when the caller expects one attachment to appear across Locations.

## Contribution And Precedence

Built-in Location tools contribute through `ToolRegistry.contribute(...)`. Application tools attach through `ApplicationTools.attach(...)`, exposed publicly as `opencode.tools.attach(...)`.

Both contribution mechanisms use `State` scoped transforms:

- Closing a contribution Scope rebuilds state without that contribution.
- A later same-name application attachment wins while active.
- Closing that later attachment reveals the earlier active application contribution.
- A Location tool always takes precedence over an application tool with the same name.
- Application attachment inputs are captured before registering the replayable transform; later caller mutation must not alter a contribution during an unrelated rebuild.

Do not introduce another application-specific tool type or registry. Plugins should contribute existing native tools or internal registry entries at the lifetime they actually own.

## Dynamic Removal Semantics

Definitions and settlement intentionally resolve the current effective tools independently. There is no provider-turn snapshot, attachment lease, or draining detach.

```txt
Embedding App               ApplicationTools       Location ToolRegistry                 Session Runner
      │                             │                        │                                  │
      ├─ attach({ opencord_run }) ──▶                        │                                  │
      │                             │                        │                                  │
      │                             │                        ◀─ definitions() ──────────────────┤
      │                             │                        │                                  │
      │                             ◀─ entries() ────────────┤                                  │
      │                             │                        │                                  │
      │                             │                        ├─ current effective definitions ──▶
      │                             │                        │                                  │
      ├─ attachment Scope closes ───▶                        │                                  │
      │                             │                        │                                  │
      │                             │                        ◀─ settle(opencord_run) ───────────┤
      │                             │                        │                                  │
      │                             ◀─ current lookup ───────┤                                  │
      │                             │                        │                                  │
      │                             │                        ├─ Unknown tool ───────────────────▶
      │                             │                        │                                  │
```

Consequences of this choice:

- Closing an attachment Scope revokes the tool immediately for calls that have not started settling.
- A call produced from an earlier advertised definition may fail as unknown.
- If a same-name replacement is currently active, a later call may execute that replacement.
- An execution that already resolved its entry continues with the handler it captured.
- Attachment Scope closure does not wait for already-started executions. Applications whose handlers depend on scoped resources must coordinate graceful shutdown themselves.

These are deliberate simplifications. Do not add snapshots, semaphores, leases, or deferred finalizers without a concrete requirement for stronger consistency or graceful draining.

## File Roles

```txt
tool/
  native.ts             plain public/Core-native executable tool value
  application-tools.ts  process-scoped State-backed application contributions
  registry.ts           Location-scoped effective lookup, validation, and execution
  builtins.ts           shipped Location tool layer composition
  read.ts, bash.ts, ... individual Location-scoped built-in contributions
```

Keep model/provider-neutral tool schemas and output projection in `@opencode-ai/llm`. Keep Session identity, permissions, Location precedence, and settlement in Core.

## Future Directions

Tool availability may eventually gain a real third scope, such as Session-specific or plugin-owned contributions:

```txt
                                            ╭─────────────────╮
                                            │ Tool definition │
                                            ╰────────┬────────╯
            ╭────────────────────────────────────────╰╮─ ─ ─ ─ ─ ─ ─ ─ future  ─ ─ ─ ─ ─ ─ ─ ─ ╮
            │                                         │
            ▼                                         ▼                                        ▼
╭───────────────────────╮                ╭────────────────────────╮                ╭───────────────────────╮
│ Process contributions │                │ Location contributions │                │ Session contributions │
╰───────────┬───────────╯                ╰────────────┬───────────╯                ╰───────────┬───────────╯
            │                                         │                                        │
            │                                         │
            ╰─────────────────────────────────────────◀─ ─ ─ ─ ─ ─ ─ ─  future ─ ─ ─ ─ ─ ─ ─ ─ ╯
                                          ╭──────────────────────╮
                                          │ Effective resolution │
                                ╭─────────╰───────────┬──────────╯────────────╮
                                │                     │                       │
                                ▼                                             ▼
                ╭───────────────────────────────╮                ╭─────────────────────────╮
                │ Advertise current definitions │                │ Execute current handler │
                ╰───────────────────────────────╯                ╰─────────────────────────╯
```

Prefer these directions only when a concrete use requires them:

- **Contextual availability:** Add Session/agent/plugin filtering at effective resolution. Keep tool definitions independent from where they are enabled.
- **Hierarchical overlays:** If a third contribution scope becomes real, consider one registry abstraction with process, Location, and Session overlays rather than adding another special registry service.
- **Plugin tools:** Reuse the existing native tool value for restricted handlers and `ToolRegistry.Entry` for trusted Core-owned capabilities. Choose process or Location contribution lifetime explicitly.
- **Stale-call rejection:** If executing a same-name replacement is unsafe, attach an identity/version to advertised definitions and reject stale calls without retaining removed handlers.
- **Pinned provider turns:** If exact advertisement-to-execution consistency becomes necessary, snapshot effective entries for one provider turn. This weakens immediate revocation.
- **Graceful plugin unload:** If attachment-owned resources must outlive started executions, add explicit execution draining. Keep this separate from whether new calls can discover the tool.
- **Cluster placement:** `ApplicationTools` is process-global, not cluster-global. Cluster-wide contribution and execution ownership require a separate durable design.

When choosing stronger semantics, state which property matters: immediate revocation, stale-call rejection, exact handler pinning, or graceful resource draining. They are different guarantees and should not arrive as one bundled lifecycle mechanism.
