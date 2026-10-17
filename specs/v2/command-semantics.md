# Command Execution and Mentions

Status: **Current V2 behavior; design confirmation requested.**

This record describes the native command contract already implemented on V2 and proposes retaining these choices to resolve [#34847](https://github.com/anomalyco/opencode/issues/34847). Upstream design confirmation is requested through this record. Core owns the runtime contract, Schema owns configuration and prompt shapes, and the command documentation explains the user-facing behavior.

## Decisions

| Question                                              | Selected behavior                                                                                                                                                                              | Reason                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Should commands support subtasks?                     | Support configured subagent commands with `subagent`; retain `subtask` as a compatibility alias.                                                                                               | Command templates can initiate delegated work through the existing native child-session contract. |
| Which execution primitive should they use?            | Use child Sessions, `SubagentJob`, and the common `Job` lifecycle.                                                                                                                             | Status, cancellation, recovery, and completion delivery keep their existing owners.               |
| Can a command request automatic background execution? | Background the child when `subagent` is true or an explicitly configured command agent has subagent mode. Explicit false overrides that mode default. Ordinary commands admit a parent prompt. | Execution policy comes from command configuration and is applied after template expansion.        |
| How are template `@agent` mentions interpreted?       | Preserve the text. Use command `agent` metadata to select execution, and preserve caller-supplied agent attachments.                                                                           | An agent attachment is metadata; executing a child is a separate operation.                       |
| How are template `@file` mentions interpreted?        | Preserve the text. Preserve caller-supplied file attachments and use normal prompt attachment loading.                                                                                         | Files have explicit sources and follow the existing attachment boundary.                          |

Literal mentions are the selected behavior for this contract. Adding automatic attachment resolution would require its own path, source-range, permission, and error semantics.

## Admission and Selection

Built-in commands, ordinary configured commands, and MCP prompts expand into normal prompt input. `/review` uses this path unless overridden by user configuration. Explicit files, agents, and skills survive command expansion; file loading and supported media types remain owned by normal prompt assembly.

For native `commands` configuration and Markdown frontmatter, `subagent ?? subtask` determines the explicit policy. This includes false: `subagent: false` overrides both `subtask: true` and the specified agent's subagent mode. Legacy singular `command` configuration uses `subtask`, which normalization maps to the native policy.

On the parent path, an explicitly configured command agent changes the Session's selected agent. The command model takes precedence over the configured model of that explicitly selected agent. If neither supplies a model, the parent model is retained. Agent and model selections persist for later prompts; the prompt shape has no per-input override.

On the child path, the command creates a parent-linked Session and admits the complete expanded prompt with `resume: false` before starting its Job. The command agent, or the parent's current agent when omitted, selects the child agent. The child model is the command model, then the selected agent's configured model, then the parent model. The parent's selected agent and model remain unchanged.

## Template and Execution Order

Parameters are substituted before shell interpolation. Template shell commands run in the Session's Location directory and finish before parent prompt admission or child creation. The child background setting applies to model execution after this expansion; it does not detach template shell processes.

The command returns while a background child's model execution may still be active. Child completion, failure, or user cancellation produces a synthetic parent notice through the common Subagent completion mechanism. The notice carries the child's identity, state, and result, and can wake parent execution.

User cancellation targets the child through `Session.interrupt`. The execution terminal path cancels the corresponding Job and delivers the cancellation notice. Closing the owning application scope preserves running recoverable markers; startup recovery resumes the child through `SessionRestart`. The marker remains durable until parent notification admission is committed. Notification identity makes replay idempotent. These rules do not promise exactly-once external tool side effects.

## Implementation and Regression Evidence

- [ConfigCommandPlugin](../../packages/core/src/config/plugin/command.ts) loads command definitions, expands templates, selects execution, and preserves attachments.
- [ConfigCommand](../../packages/schema/src/config/command.ts) and configuration normalization own the native fields and compatibility alias.
- [SubagentJob](../../packages/core/src/session/subagent-job.ts), [completion](../../packages/core/src/session/subagent-completion.ts), and [restart](../../packages/core/src/session/execution/restart.ts) own child execution and parent notification.
- [Command subagent tests](../../packages/core/test/config/command-subagent.test.ts) exercise real command admission and execution with a deterministic model transport. They cover native and legacy configuration, background completion, literal mentions, explicit attachments, public interruption, notification replay, persistent-database application teardown/rebuild, gated real shell execution, and selection persistence in subsequent prompts.
- [Configured command tests](../../packages/core/test/config/command.test.ts) cover template expansion and shell directory behavior. [Command plugin tests](../../packages/core/test/plugin/command.test.ts) cover built-ins and the MCP adapter boundary.
- [V2 user documentation](../../services/www/src/docs/content/commands.mdx) describes the selected contract; its JSON and JSONC examples are validated by [documentation tests](../../packages/core/test/config/command-docs.test.ts).

The recovery regression closes and rebuilds the production service graph with persistent SQLite. It does not kill an OS process. The model transport is deterministic, and the MCP regression uses a remote adapter fixture.
