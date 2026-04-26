# Security & Configuration Boundaries

Opencode implements a robust configuration merging strategy and strict permission model to balance user autonomy with safe, constrained execution.

## 1. Configuration Resolution Hierarchy

Opencode's configuration engine is designed to support both global (OS-level) user preferences and project-specific overrides. This ensures developers can maintain personal defaults (like preferred LLM providers) while allowing individual repositories to dictate strict architectural rules (like specialized agents or specific permission boundaries).

### Directory Traversal via `AppFileSystem.up`

The core of the configuration resolution relies on a targeted directory traversal mechanism, primarily orchestrated in [`src/config/paths.ts`](../../packages/opencode/src/config/paths.ts).

Instead of making simple, static path assumptions, Opencode uses `AppFileSystem.up` to walk up the directory tree from the current working directory (`cwd`) until it reaches the `worktree` root (the root of the Git repository or project).

The system searches for the `.opencode` directory in the following deterministic order:

1. **Local Project Scope:** Traverses upwards from `cwd` to `worktree` looking for `.opencode`.
2. **Global OS Scope:** Looks for `.opencode` in `Global.Path.home` (e.g., `~/.opencode`).
3. **Environment Override:** Appends `Flag.OPENCODE_CONFIG_DIR` if specified.

### Deep Merging Strategy

Once the relevant `.opencode` directories and `opencode.jsonc` files are located, the configuration engine does not simply overwrite settings; it performs a **deep merge**. As implemented in [`src/config/config.ts`](../../packages/opencode/src/config/config.ts), the properties are overlaid. 

*Example:* A user can define a complex `@plan` agent globally in `~/.opencode/agents.jsonc`, and a specific project can override just the `model` property of that `@plan` agent in `/path/to/project/.opencode/agents.jsonc`, without needing to redefine the agent's prompts or permissions.

---

## 2. The Permission System

Opencode's permission model strictly controls the autonomous actions an agent can take based on the deeply merged configuration. It identifies permissions that resolve into three strict actions: **`allow`**, **`deny`**, or **`ask`** (which pauses execution and prompts the user).

### Scope of Enforcement

The specific permissions enforced span several domains:

- **Tool Execution:** Direct access gating to built-in tools like `bash`, `read`, `edit`, `write`, `apply_patch`, `glob`, `grep`, `webfetch`, `websearch`, `codesearch`, `lsp`, and `skill`. Modifying operations like `write`, `apply_patch`, and `edit` often collapse under a single `edit` permission umbrella to ensure safety overrides apply uniformly.
- **Agent Capabilities:**
  - `task`: Governs the ability to spawn subagents.
  - `todowrite`: Governs the ability to manipulate the task/planning state.
  - `question`: The capability to halt and ask the user questions.
  - `doom_loop`: Governs autonomous continuous execution/retry loops.
- **Filesystem & Path Scopes:**
  - `external_directory`: Specifically restricts or allows an agent to access paths outside the immediate workspace boundaries, protecting against arbitrary system file traversal.
- **MCP (Model Context Protocol):** Evaluates permissions against external tools and server protocols.

### Evaluation and Enforcement

The architecture relies on the Effect framework and SQLite for robust execution:

- **`ConfigPermission.Info`**: Maps permissions to rule maps (e.g., `edit: { "src/*": "allow", "etc/passwd": "deny" }`). It utilizes a Zod-Preprocess wrapper to intentionally preserve JSON object key order, as rule precedence depends on insertion order.
- **`evaluate()`**: The core resolution logic ([`src/permission/evaluate.ts`](../../packages/opencode/src/permission/evaluate.ts)). It evaluates rulesets using `findLast()` combined with wildcard matching. Because it uses `findLast`, later rules override earlier ones, and if no match is found, it inherently defaults to `{ action: "ask" }`.

```mermaid
flowchart TD
    subgraph rule_eval ["Rule Evaluation: findLast()"]
        R1[Rule 1: edit:* = allow]
        R2[Rule 2: edit:src/* = ask]
        R3[Rule 3: edit:src/secret.ts = deny]
        
        R1 --> R2
        R2 --> R3
        
        R3 -.->|Overrides| R2
        R2 -.->|Overrides| R1
        
        Note[Because of findLast, later rules override earlier ones.<br>If no rule matches, it inherently defaults to 'ask'.]
    end

    subgraph tool_interception [Tool Interception]
        Tool[Tool Invoked] --> Eval{evaluate()}
        
        Eval -->|allow| Run[Execute Tool]
        Eval -->|deny| Fail[Throw DeniedError]
        Eval -->|ask| Pause[Suspend Fiber & Prompt User]
        
        Pause -->|User says Yes| Run
        Pause -->|User says Always| Save[Save Rule & Execute Tool]
        Pause -->|User says No| Fail
    end
```

- **`Permission.Service` State Machine**: The active interception engine. When a tool runs, it calls `ask()`. If the evaluator returns `"ask"`, the service creates a `Deferred` Promise, stores it in an in-memory `pending` map, and fires an event. The agent fiber completely suspends execution until the user replies.

### Permission Storage Levels

Permissions operate dynamically across a fallback chain composed of three tiers:

1. **Agent Level ([`src/config/agent.ts`](../../packages/opencode/src/config/agent.ts))**: Each agent defines its operational boundaries. A `permission` block explicitly maps allowed and denied tools for that specialized agent (e.g., forcing the `@plan` agent to have `edit: "deny"`).
2. **Project / Workspace Level ([`src/session/session.sql.ts`](../../packages/opencode/src/session/session.sql.ts))**: If a user approves an "ask" request with the `"always"` modifier, that rule is written to the `PermissionTable` via Drizzle ORM. This table has a `project_id` primary key, acting as a persistent Project-scoped memory cache.
3. **Session Level ([`src/session/session.sql.ts`](../../packages/opencode/src/session/session.sql.ts))**: The `SessionTable` possesses a `permission: text` column, allowing explicit permission overrides or historical snapshots of rules to be scoped to a single conversational session thread.

---

## 3. Source Code Reference

The mechanics discussed in this document are primarily implemented in the following files:

- **[`src/config/paths.ts`](../../packages/opencode/src/config/paths.ts)**: The directory traversal engine driving the configuration hierarchy via `AppFileSystem.up`.
- **[`src/config/config.ts`](../../packages/opencode/src/config/config.ts)**: Implements the "Deep Merging Strategy" overlaying local and global `.jsonc` files.
- **[`src/config/agent.ts`](../../packages/opencode/src/config/agent.ts)**: Defines the Zod schema and defaults for Agent-level permission boundaries.
- **[`src/permission/evaluate.ts`](../../packages/opencode/src/permission/evaluate.ts)**: The core evaluation engine that processes wildcards and resolves the `allow/deny/ask` fallback chain using array order precedence.
- **[`src/permission/index.ts`](../../packages/opencode/src/permission/index.ts)**: The primary `Permission.Service` state machine that intercepts execution fibers, stores `Deferred` promises when an `"ask"` is triggered, and suspends the LLM.
- **[`src/session/session.sql.ts`](../../packages/opencode/src/session/session.sql.ts)**: Implements the `PermissionTable` and `SessionTable` storage models for Project and Session scoped constraints.