# Opencode Architecture Overview

This documentation suite provides a comprehensive analysis of the internal mechanics powering the Opencode platform. It is designed for developers, core contributors, and plugin authors who want to understand how Opencode orchestrates the underlying runtime, external tool protocols, and LLM feedback loops.

## Reading Guide: The Architecture Components

This documentation suite is broken down into 7 logical components that map the architecture from ingestion to execution. To deeply understand Opencode's internal mechanics, we recommend reading them in the following order:

1. **Ingestion & Context** ([01_prompt-and-context.md](./01_prompt-and-context.md)): How the prompt is constructed, how the filesystem acts as state, and how messages are translated to the AI SDK.
2. **Agents and Modes** ([02_agents-and-modes.md](./02_agents-and-modes.md)): Agent selection, system daemons, and mode-based enforcement (Plan vs. Build) that gate execution.
3. **Equipping the Agent** ([03_tooling-and-capabilities.md](./03_tooling-and-capabilities.md)): How tools are filtered and dynamically injected, and how custom Skills are loaded from disk.
4. **Action & Execution Loops** ([04_execution-and-feedback.md](./04_execution-and-feedback.md)): Synthesized feedback loops (LSP diagnostics, AST queries) and how shell streams are managed via the PTY integration.
5. **State & Memory Management** ([05_state-and-memory.md](./05_state-and-memory.md)): Shadow Git checkpointing, asynchronous daemon operations, SQLite/Drizzle ORM schema, and linear state pagination.
6. **Security & Configuration Boundaries** ([06_security-and-configuration.md](./06_security-and-configuration.md)): How configurations are merged across global/project scopes (`AppFileSystem.up`), strict tool interception boundaries, and the `allow/deny/ask` ruleset engine.
7. **Core Framework & Observability** ([07_core-framework.md](./07_core-framework.md)): The hybrid functional programming paradigm underlying the codebase, combining Effect-TS structured concurrency with the decoupled Pub/Sub architecture for UI updates and OpenTelemetry integrations.

---

## 1. Core Architecture Principles

Opencode is designed as a highly stateful, event-driven client/server architecture built natively on the **Effect-TS** runtime. It is designed to bridge the stateless nature of Large Language Models with the highly stateful, permission-gated environment of a local codebase. 

- **Provider Independence:** Utilizes the **Vercel AI SDK** purely as a standardized network boundary, decoupling internal reasoning and tool orchestration from any specific vendor API. Seamlessly hot-swaps between massive cloud models and local models. *(See [SDK Bridging](./01_prompt-and-context.md#3-bridging-the-vercel-ai-sdk))*
- **Agentic Kernel:** Acts as an operating system managing Token Budgets (context limits) and Execution Threads (tool orchestration). Allows the agent to run in cyclic, autonomous loops (`Thought -> Action -> Observation`) before ever yielding control back to the user. *(See [Agents & Modes](./02_agents-and-modes.md))*
- **Reactive & Deliberative Loops:** Wraps the model's native reasoning in deterministic, harness-level loops. A 'Fast Loop' intercepts execution failures (e.g., catching a broken build or malformed artifact) and autonomously re-prompts the agent to fix it in the background. A 'Slow Loop' handles high-level task planning. *(See [Feedback Loops](./04_execution-and-feedback.md))*
- **Functional Concurrency & Resource Safety:** Opencode is built natively on the **Effect-TS** functional programming runtime. It blends native Node.js async/await with structured concurrency (Scopes) for safe resource management. Guarantees flawless garbage collection of background processes (like MCP servers) and file watchers upon interruption. *(See [Garbage Collection](./07_core-framework.md))*
- **Event-Driven Pub/Sub UI:** Decouples the terminal UI from the execution loop using a centralized `Effect.PubSub` event bus. Tool executions and database updates broadcast sync events, allowing the UI to reactively render updates without polling or blocking the main agent loop. *(See [Pub/Sub Bus](./07_core-framework.md))*
- **Dual-Mode Architecture:** Hardcodes a rigid, two-state workflow engine ("Plan" vs "Build") directly into the core execution loop. Physically strips editing tools and injects explicit read-only constraints at the API level during the "Plan" phase. *(See [Mode Structure](./02_agents-and-modes.md#2-the-mode-structure))*

---

## 2. Operational Mechanics

Beyond structural differences, Opencode's daily execution loop relies on explicit, deterministic tooling (e.g., `grep`, `glob`, `read`) rather than passive, noisy semantic search.

- **Sandboxed State & Context:** Relies on "Filesystem-as-State" injected dynamically, with execution contexts strictly sandboxed per-directory using `InstanceState` scopes. *(See [Doc 01](./01_prompt-and-context.md) & [Doc 05](./05_state-and-memory.md))*
- **Strict Permission Gating:** Utilizes a robust `allow/deny/ask` ruleset engine that evaluates permissions before tool injection. Hardcodes read-only constraints for specific architectural agents (e.g., "Plan" mode). *(See [Doc 02](./02_agents-and-modes.md) & [Doc 06](./06_security-and-configuration.md))*
- **Dynamic Extensibility (MCP & Skills):** Natively translates Model Context Protocol (MCP) JSON-RPC schemas into SDK tools, handles complex OAuth flows, and dynamically loads local `SKILL.md` workflows from disk. *(See [Doc 03](./03_tooling-and-capabilities.md))*
- **Synthesized Feedback Loops:** Intercepts codebase modifications to inject deterministic feedback (e.g., Language Server Protocol [LSP] diagnostics, bash `stderr`) directly back into the LLM's observation window. *(See [Doc 04](./04_execution-and-feedback.md))*
- **Memory & Checkpointing:** Employs an invisible secondary Git tree for surgical reversions, background daemons for token compaction, and a stateful SQLite `TodoTable` for tracking multi-step plans. *(See [Doc 05](./05_state-and-memory.md))*

---

## 3. Codebase Map

To navigate the implementation details discussed in this report, here is a brief map of the core monorepo packages relevant to the architecture:

- **`packages/opencode/src/effect/`**: The InstanceState models and Scopes powering the concurrency model. **Note:** The entire Opencode codebase blends native Node.js async/await with the Effect-TS functional programming framework for structured concurrency (See [Doc 07](./07_core-framework.md)).
- **`packages/opencode/src/bus/`**: The decoupled Pub/Sub Event Bus definitions that sync background state to the UI.
- **`packages/opencode/src/`**: The core execution harness, tool registry, and session processor.
- **`packages/sdk/`**: Contains the generated openAPI schemas and client definitions.
- **`packages/ui/`**: A SolidJS-based web component library (e.g., for webview or desktop applications), completely decoupled from the CLI interface.
- **`packages/shared/`**: Common utilities, SQLite database schemas, and shared types.
