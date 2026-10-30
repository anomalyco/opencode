# Upstream OpenCode Codebase Audit

**Date**: 2026-10-31  
**Repository Origin**: `https://github.com/anomalyco/opencode.git`  
**Upstream Branch**: `dev`  
**Upstream Baseline Commit**: `2e29481d5c5b92b75b6a29eeca8a8ff8ed166af7`  
**Upstream Release**: `v2.2.4 (#60664)`  
**License**: MIT License (Copyright © 2025 opencode)  
**Package Manager**: `bun@1.4.4`  

---

## 1. Executive Summary & Verification Methodology

This comprehensive audit was conducted on the official OpenCode repository to establish a verified baseline of its software architecture, subsystems, data persistence models, and extension mechanisms prior to implementing application enhancements.

Every finding in this report has been verified against actual source code files, lines, and database schemas. No architectural assumptions from outdated documentation have been used.

---

## 2. Git History & Baseline Verification

- **Remote URL**: `https://github.com/anomalyco/opencode.git`
- **Tracked Upstream Branch**: `origin/dev`
- **Checked-out Feature Branch**: `universal-agent-ecosystem` (branched cleanly from `origin/dev` at commit `2e29481d5c5b92b75b6a29eeca8a8ff8ed166af7`)
- **Git Commit Log (Upstream Baseline)**:
  - `2e29481d5c`: fix(core): keep MCP quiet while a location shuts down (#60668)
  - `bf5d12c588`: fix(app,tui): hide MCP integrations from the connect menu (#60675)
  - `6700dd87b5`: feat(core): accept a percentage for compaction.buffer (#60647)
  - `822594b9ae`: fix(ai): stop demoting unsigned and interrupted reasoning to text (#60498)
  - `872f694b05`: release: v2.2.4 (#60664)

---

## 3. Technology Stack & Monorepo Structure

### 3.1 Primary Technologies
- **Runtimes & Package Management**: Bun (`bun@1.4.4`) executes build scripts, unit tests, and runtime processes. Node.js compatibility layers are utilized where native modules (`node-pty`) are required.
- **Language**: TypeScript 5.8+ targeting TypeScript 7.1 semantics. Type-checking canonical verification runs via `@typescript/native@7.1.0-beta` (`bun typecheck:tsc`) and local fast checks via `bun check --no-script`.
- **Architectural Paradigms**:
  - **Effect-TS (`effect`)**: Powers dependency injection (`Context.Service`, `Layer`), concurrency primitives (`FiberMap`, `Semaphore`, `PubSub`, `Latch`), error modeling (`Schema.TaggedError`), and schema validation (`@effect/schema`).
  - **Drizzle ORM (`drizzle-orm`)**: Powers SQLite table modeling, migrations, and queries wrapped in Effect transaction boundaries.
  - **SolidJS (`solid-js`)**: Powers the reactive user interface in `packages/app` and `packages/desktop`.
  - **Electron (`electron@34.x`)**: Bundles the desktop application.
  - **Astro (`astro@5.x`)**: Powers public documentation and blog services.
  - **Turborepo (`turbo@2.10.2`)**: Coordinates monorepo build and typecheck tasks across 40 packages.

### 3.2 Monorepo Package Inventory (40 Workspaces)

| Workspace Name | Location | Primary Role |
| :--- | :--- | :--- |
| `@opencode/schema` | `packages/schema` | Canonical Effect Schemas, types, and DTO contracts |
| `@opencode/protocol` | `packages/protocol` | Public Effect HttpApi routes, schemas, and endpoints |
| `@opencode/client` | `packages/client` | Auto-generated SDK client generated from `@opencode/protocol` |
| `@opencode/core` | `packages/core` | Core business logic, session runner, tools, SQLite database, MCP |
| `@opencode/server` | `packages/server` | HTTP/RPC daemon and route handlers hosting `packages/core` services |
| `@opencode/app` | `packages/app` | Shared SolidJS frontend application (desktop and web) |
| `@opencode/desktop` | `packages/desktop` | Electron desktop wrapper, main process, IPC transport, storage |
| `@opencode/tui` | `packages/tui` | Terminal user interface built with OpenTUI |
| `@opencode/cli` | `packages/cli` | Command-line interface and background service supervisor |
| `@opencode/ai` | `packages/ai` | AI SDK integration, streaming LLM providers, model resolution |
| `@opencode/plugin` | `packages/plugin` | Plugin host, sandbox contracts, and runtime lifecycle hooks |
| `@opencode/gui-plugins` | `packages/gui-plugins` | GUI extension widgets and visual integrations |
| `@opencode/ui` | `packages/ui` | Shared SolidJS UI component library and primitives |
| `@opencode/theme` | `packages/theme` | Semantic theme tokens, light/dark mode definitions |
| `@opencode/sdk` | `packages/sdk` | High-level unified SDK combining Client, Core, and Server |
| `@opencode/codemode` | `packages/codemode` | AST code search, transformation, and structural code mode |
| `@opencode/patchmark` | `packages/patchmark` | Patch generation, unified diffing, and file mutation verification |
| `@opencode/latex` | `packages/latex` | LaTeX parsing and formatting |
| `@opencode/merman` | `packages/merman` | Mermaid diagram rendering |
| `@opencode/http-recorder` | `packages/http-recorder` | HTTP traffic recording and replay test utilities |
| `@opencode/httpapi-codegen`| `packages/httpapi-codegen`| Code generator translating Effect HttpApi to OpenAPI / client SDK |
| `@opencode/util` | `packages/util` | Shared system utilities, Effect helpers, FSUtil, AppProcess |
| `@opencode/session-ui` | `packages/session-ui` | Shared session UI components |
| `@opencode/simulation` | `packages/simulation` | End-to-end multi-agent simulation test harness |
| `@opencode/stories` | `packages/stories` | Storybook fixtures and visual regression tests |
| `@opencode/plugins/figma`| `packages/plugins/figma` | Figma integration plugin |
| `@opencode/console-app` | `packages/console/app` | Web console user interface |
| `@opencode/console-resource`| `packages/console/resource`| Cloud resource orchestrators |
| `@opencode/stats-app` | `packages/stats/app` | Analytics and telemetry frontend |
| `@opencode/stats-core` | `packages/stats/core` | Analytics event definitions |
| `@opencode/stats-server`| `packages/stats/server` | Analytics ingestion server |
| `@opencode/changelog` | `services/changelog` | Automated changelog compiler |
| `@opencode/files` | `services/files` | Remote file management service |
| `@opencode/update` | `services/update` | Auto-update distribution service |
| `@opencode/www` | `services/www` | Marketing web portal built on Astro |
| `@opencode/posts` | `packages/posts` | Documentation and posts service |

---

## 4. Deep Architectural Investigation

### 4.1 Project Creation & Identification

- **Implementation File**: [`packages/core/src/project.ts`](file:///c:/Users/gaumi/Documents/hidden_gravity/open_code/packages/core/src/project.ts)
- **Database Table**: `project` in [`packages/core/src/project/sql.ts`](file:///c:/Users/gaumi/Documents/hidden_gravity/open_code/packages/core/src/project/sql.ts)
- **Discovery Mechanism**:
  Upstream OpenCode has **no explicit project creation endpoint**. Projects are instantiated lazily via `Project.resolve(directory, options)`:
  1. If the directory belongs to a Git repository with a remote origin:
     ```ts
     ID.make(Hash.fast(`git-remote:${normalizedUrl}`))
     ```
  2. If cached in a local `opencode` metadata file:
     ```ts
     ID.make(fileContent.trim())
     ```
  3. If a Git repository without remote origin:
     The SHA of the root commit is used (`git.history.rootCommits(repo)[0]`).
  4. If a Mercurial repository:
     The root changeset hash is used (`hg log -r 'roots(all())'`).
  5. If an unversioned directory:
     ```ts
     ID.make(Hash.fast(`directory:${directory}`))
     ```
  6. Global project fallback: `ID.global` (`"global"`).

- **Persistence**:
  When resolved, `upsertProject` executes an atomic SQLite transaction inserting or updating `project` table columns: `id`, `worktree` (canonical directory), `vcs`, `name`, `icon_url`, `time_created`, `time_updated`, `time_active`, `time_archived`, and `sandboxes`.

### 4.2 Multi-Folder Workspaces & Root Switching

- **Upstream Implementation**:
  - Upstream OpenCode strictly couples **one Project to one canonical directory** (`row.worktree`).
  - The secondary directory table `worktree` (`WorktreeTable` in `packages/core/src/worktree/sql.ts`) is only used for Git worktrees cloned from the exact same Git repository:
    ```ts
    directories.push({
      projectID: project.id,
      directory: project.directory,
      strategy: project.vcs.type === "git" ? Worktree.StrategyID.make("git") : undefined,
    })
    ```
  - **Deficiency Identified**: Upstream contains **zero support for attaching independent folders, repositories from different parent directories, or paths on different drive letters**.
  - **Root Switching**: Upstream only switches canonical roots if the old canonical root physically no longer exists on disk (`Project.persist`, lines 145–156 of `packages/core/src/project.ts`).

### 4.3 Project Deletion & Archiving

- **Upstream Implementation**:
  - Upstream has **no explicit project deletion API endpoint**.
  - It only possesses an automated background cleanup job `Project.sweep()`, which scans for projects whose canonical directories are missing and whose `time_updated` and `time_active` are older than 1 hour (`SWEEP_INTERVAL`).
  - There is no mechanism for a user to delete, archive, restore, or manage projects from the UI.

### 4.4 Session Persistence & Conversation State

- **Implementation**: [`packages/core/src/session/`](file:///c:/Users/gaumi/Documents/hidden_gravity/open_code/packages/core/src/session/)
- **Database Tables**:
  - `session_v2`: Represents an agent session containing `id`, `project_id`, `workspace_id`, `parent_id`, `title`, `cost`, `tokens_*`, `time_busy`, `time_idle`, `time_archived`.
  - `session_message`: Sequentially ordered messages (`seq`, `type`, `data`).
  - `session_part`: Granular assistant content chunks (text, reasoning, tool-calls).
  - `session_inbox`: Durable prompt queue before message delivery (`SessionExecution.wake(sessionID)`).
- **Execution Lifecycle**:
  - Prompt admission publishes `session.inbox.enqueued`.
  - The model runs via `llm.stream` inside `packages/core/src/session/runner/`.
  - Message delivery writes `session_message` and deletes the consumed `session_inbox` item in a single transaction.

### 4.5 File Attachments & Media

- **Upstream Implementation**:
  - Upstream attaches files **only at the per-prompt/per-conversation level** using `Prompt.FileAttachment` ([`packages/schema/src/prompt.ts`](file:///c:/Users/gaumi/Documents/hidden_gravity/open_code/packages/schema/src/prompt.ts)).
  - Files are stored as Base64 strings or ephemeral `media:<sha256>` blob references.
  - **Deficiency Identified**: Upstream contains **no persistent project-level attachments subsystem**. There is no ability to upload project specifications, manuals, PDFs, spreadsheets, or architecture documents that persist across conversations and can be queried or retrieved by the agent.

### 4.6 Instructions & Rules Loading

- **Upstream Implementation**:
  - Handled by `ConfigInstructionPlugin` ([`packages/core/src/config/plugin/instruction.ts`](file:///c:/Users/gaumi/Documents/hidden_gravity/open_code/packages/core/src/config/plugin/instruction.ts)).
  - Upstream **hardcodes a search for `AGENTS.md` only**:
    ```ts
    const candidates = [
      ...(discovery.global ? [globalFile] : []),
      ...(project ? ancestorDirectories(start, stop).map((dir) => join(dir, "AGENTS.md")) : [])
    ]
    ```
  - **Deficiency Identified**: Upstream completely ignores `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`, OpenAI Codex instruction conventions, and Antigravity rules.

### 4.7 Skills Discovery & Execution

- **Upstream Implementation**:
  - Handled by `ConfigSkillPlugin` ([`packages/core/src/config/plugin/skill.ts`](file:///c:/Users/gaumi/Documents/hidden_gravity/open_code/packages/core/src/config/plugin/skill.ts)) and `SkillScan` ([`skill-scan.ts`](file:///c:/Users/gaumi/Documents/hidden_gravity/open_code/packages/core/src/config/plugin/skill-scan.ts)).
  - Scans for files named `SKILL.md` inside directories named `skill` or `skills`.
  - **Deficiency Identified**: Upstream cannot import skills from remote Git repositories, cannot select specific branches/tags/subdirectories, cannot parse Codex/Antigravity skill structures, and does not provide an extension registry with provenance tracking.

### 4.8 MCP Server Configuration & Connections

- **Upstream Implementation**:
  - Handled by `Mcp` ([`packages/core/src/mcp/index.ts`](file:///c:/Users/gaumi/Documents/hidden_gravity/open_code/packages/core/src/mcp/index.ts)).
  - Supports transports: Stdio (`packages/core/src/mcp/stdio.ts`), HTTP SSE (`packages/core/src/mcp/client.ts`), and OAuth integrations.
  - **Deficiency Identified**: Upstream lacks preflight connection diagnostics. When an MCP server configuration fails, the user is given no granular breakdown of transport latency, binary existence, environment variable interpolation, or tool discovery status. Upstream also cannot import configurations from Claude Desktop (`claude_desktop_config.json`) or Cursor (`cursor_mcp.json`).

### 4.9 Plugin Architecture & Host

- **Upstream Implementation**:
  - Handled by `packages/plugin/` and `packages/core/src/plugin/host.ts`.
  - Built-in plugins are registered in `packages/core/src/plugin/internal.ts`.
  - **Deficiency Identified**: Plugins are loaded without static security analysis. Third-party extensions cannot be inspected for dangerous APIs (`eval`, process spawning, token exfiltration) prior to execution.

---

## 5. Architectural Extension Strategy (Extend, Never Replace)

OpenCode's design allows clean extension through modular Effect layers and service nodes without modifying or destabilizing core invariants:

1. **Workspace Management Extension**:
   - Upstream `Project` service remains intact.
   - We extend the workspace layer by providing `MultiFolderWorkspace` and `ProjectOperations` services alongside `Project`.
   - Projects can be created explicitly, multi-folder mappings are stored in `.opencode/workspaces.json`, and safe non-destructive deletion policies are enforced.
2. **Universal Extension Compatibility Engine**:
   - Implemented as an independent subsystem under `packages/core/src/extension/`.
   - Uses Common Intermediate Representation (CIR) to adapt Skills, MCP servers, Rules, and Plugins.
   - Preserves upstream `Mcp.Service` while adding `UniversalMcpManager` for preflight diagnostics and third-party config migration.
3. **Agent Context Tools**:
   - Registered cleanly into `packages/core/src/plugin/internal.ts` alongside built-in tools (`read`, `write`, `shell`).
   - Tools `project_attachment`, `workspace_folder`, and `universal_extension` provide the LLM with direct runtime awareness of the enhanced features.
4. **Desktop & App Settings UI**:
   - Extended `packages/app/src/settings/` with dedicated tabs: `project-folders.tsx`, `project-attachments.tsx`, and `project-extensions.tsx`.
   - Preserves all upstream UI tokens, buttons, and navigation patterns.
