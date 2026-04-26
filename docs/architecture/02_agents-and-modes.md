# Agents and Modes

## 1. Agent Extensibility

Agents are highly extensible, modular entities that serve as the primary mechanism for prompt customization and capability delegation within Opencode. Implemented as discrete configurations that bind specific system prompts, tool permissions, and model routing rules together, they are designed to be easily modified or extended by the user without requiring source code changes. Adding a new custom agent—whether it's a deep architectural planner routed to a heavyweight model like `gpt-4o` or a specialized formatting tool wired to a faster model like `claude-3-haiku`—simply involves defining its parameters in standard configuration files (like JSON or YAML). This allows users to effortlessly expand the system's capabilities, injecting specialized workflows or overriding default behaviors by mapping a new agent name to its desired tools and system constraints.

### Existing Agents Matrix

| Agent Name | Type | Description |
|---|---|---|
| `@build` | Primary | The main execution agent. Has full read/write access and tool capabilities. |
| `@plan` | Primary | The primary architectural agent. Forced into strict read-only mode to safely explore and construct execution plans without mutating state. |
| `@general` | Primary | A standard conversational agent without specialized workflow constraints. |
| `@explore` | Subagent | A read-only file search specialist spawned by other agents to isolate large codebase exploration tasks from the primary context window. |
| `@compaction` | System | An invisible, asynchronous daemon that continuously monitors token usage and summarizes older conversation turns to prevent context exhaustion. |
| `@title` | System | A lightweight utility agent that automatically generates concise thread titles for historical sessions. |
| `@summary` | System | A background agent responsible for distilling session accomplishments into concise progress reports. |

---

## 2. The Mode Structure

Technically speaking, the `@plan` and `@build` agents are fundamentally just standard Agents that the system hot-swaps between ([`src/agent/agent.ts`](../../packages/opencode/src/agent/agent.ts)). There is no overarching generic "Mode" primitive in the Opencode type system. However, the system elevates these two specific agents into the architectural concept of "Modes" by hardcoding systemic behavior around their specific string names.

The restriction during the "Plan" phase is not merely a conversational suggestion; it is rigorously enforced through a dual-layer blockade grounded in the codebase:

1. **Hardcoded Prompt Injection:** The `SessionPrompt` pipeline ([`packages/opencode/src/session/prompt.ts`](../../packages/opencode/src/session/prompt.ts)) contains hardcoded logic specifically looking for `if (input.agent.name === "plan")`. When triggered, it intercepts the execution loop via the `insertReminders` function to forcibly inject a `<system-reminder>` instructing the model that it is in a read-only phase. Similarly, transitioning from `@plan` to `@build` triggers a hardcoded reminder that the read-only phase has ended (`if (wasPlan && input.agent.name === "build") { ... }`).
2. **Permission Interception (Hard Enforcement):** The `@plan` agent is defined in [`packages/opencode/src/agent/agent.ts`](../../packages/opencode/src/agent/agent.ts) with a strict configuration that explicitly denies the `edit` action umbrella (`edit`, `write`, `apply_patch`) for all files (`"*": "deny"`), except for designated `.opencode/plans/*.md` files and global OS-level data cache paths (`path.join(Global.Path.data, "plans", "*")`). When a modifying tool under this umbrella is invoked, it calls `Permission.evaluate()`. Because the plan agent's configuration evaluates to "deny", the system immediately throws a `DeniedError`, suspending tool execution before the filesystem is ever touched. **Note:** The `bash` tool is *not* blocked by this configuration (it defaults to `"allow"`), so the system heavily relies on the prompt-level read-only constraint to prevent destructive shell commands.

Clarifying this depth is essential: while adding a standard Agent with custom read-only permission constraints is as simple as updating a configuration file, creating a completely new integrated "Mode" (with unique UI state representations, distinct transitions, and custom prompt injection loops like `@plan`) would require extensive TypeScript source code modifications to the session processor and prompt pipelines. There is no C++ or compiled native code required to modify these behaviors.

---

## 3. Source Code Reference

The mechanics discussed in this document are primarily implemented in the following files:

- **[`packages/opencode/src/agent/agent.ts`](../../packages/opencode/src/agent/agent.ts)**: The core registry and evaluation schema for Agents. This file holds the structural definitions mapping an agent's string name (e.g., `@plan`) to its specific permission boundaries and default models.
- **[`packages/opencode/src/config/agent.ts`](../../packages/opencode/src/config/agent.ts)**: The configuration resolution layer that merges default agent definitions with user-provided overrides.
- **[`packages/opencode/src/session/prompt.ts`](../../packages/opencode/src/session/prompt.ts)**: Contains the hardcoded prompt injection logic for "Modes", explicitly intercepting the execution loop to inject read-only constraints when the `@plan` agent is active, and detecting state transitions to `"build"` to inject exit reminders.
- **[`packages/opencode/src/permission/evaluate.ts`](../../packages/opencode/src/permission/evaluate.ts)**: The ruleset engine that actually enforces the agent's permission constraints, blocking editing tools when `"*" : "deny"` is active.
