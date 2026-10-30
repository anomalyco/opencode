# Architecture Specification: Enhanced OpenCode Universal Agent Ecosystem

## 1. Executive Summary

Enhanced OpenCode transforms OpenCode into a universal agent-customization and multi-folder project workspace environment. It preserves OpenCode's native high-performance agent execution engine, Effect runtime, and streaming protocol while adding two major subsystems:

1. **Universal Agent Extension Compatibility Engine (UAECE)**: An extensible, secure subsystem for discovering, inspecting, adapting, installing, and managing extensions across heterogeneous AI agent ecosystems (OpenCode, OpenAI Codex, Claude Code, Google Antigravity, Cursor, and emerging platforms).
2. **Advanced Project and Workspace Management (APWM)**: A persistent, multi-folder workspace root abstraction supporting dynamic folder attachment/removal, project lifecycle management (create, rename, archive, restore, safe delete), rich multi-format project attachments (PDF, DOCX, CSV, source code, archives), and persistent multi-conversation management per project.

---

## 2. Architectural Boundaries and Dependency Graph

Following OpenCode's architectural invariant:
`Schema -> Core & Protocol -> Server -> Client & UI -> Desktop & CLI`

```
  ┌─────────────────────────────────────────────────────────────┐
  │                        packages/schema                      │
  │   - Extension CIR & Manifest Schemas (Skill, MCP, Rule, etc)│
  │   - Multi-Folder Workspace & Attachment Schemas            │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
  ┌─────────────────────────────┐       ┌─────────────────────────────┐
  │        packages/core        │       │      packages/protocol      │
  │ - Extension Compatibility:  │       │ - Extension HTTP Endpoints  │
  │   Detector, CIR, Adapters,  │       │ - Project Management API    │
  │   Security, Registry        │       │ - Multi-Folder Workspace API│
  │ - Multi-Folder Workspaces   │       │ - Attachments API           │
  │ - Project Attachments Index │       │ - Conversations API         │
  │ - Conversation Coordinator  │       └──────────────┬──────────────┘
  └──────────────┬──────────────┘                      │
                 │                                     │
                 └───────────────────┬─────────────────┘
                                     ▼
                        ┌─────────────────────────┐
                        │     packages/server     │
                        │ - Extension Handlers    │
                        │ - Workspace Handlers    │
                        │ - Attachment Handlers   │
                        └────────────┬────────────┘
                                     ▼
                        ┌─────────────────────────┐
                        │     packages/app &      │
                        │    packages/desktop     │
                        │ - Universal Ext Manager │
                        │ - Multi-Folder Explorer │
                        │ - Attachments View      │
                        │ - Conversations Drawer  │
                        └─────────────────────────┘
```

---

## 3. Subsystem 1: Universal Agent Extension Compatibility Engine

### 3.1 Platform Detectors
Detects incoming extension formats automatically:
- **OpenCode**: Native `SKILL.md` or `.opencode/` configurations, `@opencode/plugin` manifests.
- **Claude Code**: `.claude/` structure, `CLAUDE.md`, Claude tool manifests, MCP configs (`claude_desktop_config.json`).
- **OpenAI Codex**: Codex skill configurations, instructions, and prompt bundles.
- **Google Antigravity**: Antigravity skills (`SKILL.md` with full metadata/scripts/references), rules (`AGENTS.md` and sidecars), Antigravity plugins with manifest.
- **Cursor**: `.cursorrules`, `.cursor/rules/*.mdc` with frontmatter `description` and `globs`.

### 3.2 Common Intermediate Representation (CIR)
Normalizes extensions into a platform-agnostic model:
```typescript
interface UniversalExtensionCIR {
  id: string
  name: string
  version: string
  category: "skill" | "mcp" | "rule" | "plugin"
  originPlatform: "opencode" | "claude" | "codex" | "antigravity" | "cursor" | "custom"
  source: ExtensionSource
  metadata: Record<string, unknown>
  permissions: RequestedPermissions
  payload: ExtensionPayload
}
```

### 3.3 Category Adapters

#### A. Skills Adapter
- Imports from local directories, `.zip`/`.tar.gz` archives, and GitHub URLs (`owner/repo`, optional subpath, branch/tag/commit).
- Preserves full directory structure (`scripts/`, `references/`, `assets/`), not just the documentation file.
- Generates OpenCode-compatible `SKILL.md` wrappers with YAML frontmatter if converting from non-standard formats.
- Supports global (`~/.config/opencode/skills/`) and project-scoped (`.opencode/skills/`) installations.
- Detects name collisions, tracks source provenance and license headers.

#### B. MCP Manager and Diagnostics
- Supports local STDIO, remote HTTP (Stream/JSON-RPC), and SSE transports.
- Environment variable injection, header injection, OAuth authentication.
- Live connectivity testing, health check, and runtime tool discovery.
- Detailed diagnostics reporting (executable presence, exit codes, stderr capture, network timeouts).
- Config importers for Claude Desktop (`claude_desktop_config.json`), Cursor (`cursor_settings.json`), and custom configs.
- Toggle enabling/disabling per server with real-time status reporting (`connected`, `pending`, `disabled`, `failed`, `needs_auth`).

#### C. Rules & Instructions Adapter
- Ingests `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`, Antigravity rules, and custom instructions.
- Honors file-matching globs (e.g. Cursor MDC `globs: ["src/**/*.ts"]`), scopes, and precedence rules.
- Merges project-level and global rules deterministically without silent discard.

#### D. Plugins & Extensions Adapter
- Inspects plugin manifests, dependencies, exported tools, hooks, and required APIs.
- Determines whether a plugin runs natively or requires an API shim.
- Generates safe adapter shims for common agent hook interfaces.
- Clear reporting of unsupported proprietary features.

### 3.4 Security & Sandboxing
- Untrusted extension boundary: extensions undergo static inspection before installation.
- Security scanner checks for suspicious patterns (unbounded shell commands, hardcoded tokens, path traversal).
- Script approval gating: executing scripts require explicit user approval.
- Secret masking: environment variables flagged as sensitive are redacted from diagnostic logs.
- Safe rollback: transactional install/uninstall restoring previous state on error.

---

## 4. Subsystem 2: Advanced Project and Workspace Management

### 4.1 Project Operations
- **Creation & Renaming**: Create projects with custom names, icons, and starting roots; rename existing projects with immediate persistence.
- **Archive & Restore**: Soft-archive inactive projects; restore anytime without losing history.
- **Safe Deletion**: Deleting a project removes its workspace metadata and session links without deleting physical source files. Optional explicit `deletePhysicalFiles: true` for destructive operations with confirmation.
- **Search & Filter**: Fast search across project names, paths, and metadata.

### 4.2 Dynamic Multi-Folder Workspaces
- Projects support an arbitrary set of attached folders across different directories and drives.
- Folders can be added or detached at runtime without moving or modifying filesystem contents.
- Dedicated primary root with secondary linked folders.
- Relinking of missing or moved folders with path reconciliation.
- Unified workspace explorer tree reflecting all attached folders.

### 4.3 Project Attachments
- Persistent project-level file storage: source code, Markdown, PDF, DOCX, CSV, Excel, images, archives.
- File indexing with extracted text and structured metadata.
- Context-efficient agent access: agents can query attachments via targeted retrieval tools rather than inlining large binaries into every LLM prompt.
- Retained across all conversations in the project.

### 4.4 Persistent Conversations
- Full multi-conversation support per project: create, list, switch, rename, archive, and delete.
- Message history and thread continuity persisted across restarts.
- Shared project attachments and multi-folder context accessible in every conversation.

---

## 5. UI Architecture

Built directly upon OpenCode's existing Solid.js and desktop Electron framework (`packages/app` & `packages/desktop`):
- Navigation integration in the main sidebar and command palette.
- **Projects & Workspaces View**: Manage projects, attached folders, and storage paths.
- **Attachments Explorer**: View, upload, preview, and delete project attachments.
- **Universal Extension Manager**: Tabs for Skills, MCP Servers, Rules, and Plugins with live status, import wizard, and diagnostic logs.
- **Compatibility & Security Dashboard**: Displays security scan results, permission grants, and adapter generation reports.
