# V2 Specifications

These documents explain V2 behavior that is difficult to recover from one source file. They are not API reference or a backlog.

## Authority

Authority follows the concern:

| Concern                                          | Owner                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| HTTP operations and transport errors             | [Protocol](../../packages/protocol/src) endpoint definitions assembled by Server `HttpApi` |
| Public domain shapes and durable event payloads  | [Schema](../../packages/schema/src)                                                        |
| Runtime behavior and persistence                 | [Core](../../packages/core/src)                                                            |
| Canonical vocabulary and cross-domain invariants | Root [CONTEXT.md](../../CONTEXT.md)                                                        |
| Contributor-critical regression guardrails       | Root [AGENTS.md](../../AGENTS.md)                                                          |

Current specifications explain cross-module contracts without copying exact types. Decision records explain why a design was selected. Historical documents describe earlier states and may use obsolete names.

Generated clients follow the assembled public `HttpApi`. GitHub issues own active work; Git history preserves removed plans and scratchpads.

## Current Contracts

| Document                | Job                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------- |
| [Session](./session.md) | Explain prompt admission, execution, instructions, compaction, and recovery boundaries. |
| [Tools](./tools.md)     | Explain tool construction, registration, execution, and settlement laws.                |

## Decisions And Proposals

| Document                                                          | Status                     | Job                                                                          |
| ----------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| [Event stream](./event-stream-architecture.md)                    | Accepted and implemented   | Record why public events use one encoded feed with independent queues.       |
| [Managed restart continuation](./session-restart-continuation.md) | Accepted and implemented   | Record why graceful managed-service restart uses private Session suspension. |
| [Instruction sync](./instruction-sync-proposal.md)                | Accepted and implemented   | Record why instruction state is value deltas plus derived rendering.         |
| [Provider policy](./provider-policy.md)                           | Proposed and unimplemented | Explore provider authorization independently from provider configuration.    |

## Historical Context

| Document                                                                | Job                                                                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Schema changelog](./schema-changelog.md)                               | Preserve the pre-release compatibility ledger. Names in older entries are intentionally historical. |
| [Catalog/config/plugin lifecycle](./catalog-config-plugin-lifecycle.md) | Preserve the option comparison that led to replayable Location-scoped catalog transforms.           |

Do not add implementation checklists here. Put actionable work in GitHub issues and package-specific contributor guidance next to the code it governs.
