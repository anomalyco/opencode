# Implementation Plan: Enhanced OpenCode Universal Agent Ecosystem

## Project Status Overview

| Subsystem | Status | Verification |
|-----------|--------|--------------|
| Baseline Audit & Environment | [x] Completed | Git clean, Bun 1.4.4 installed, 235 desktop tests passing |
| Schemas & Type Contracts | [x] Completed | CIR, Multi-Folder, Attachment, Conversation models in `packages/schema` |
| Universal Extension Engine - Skills | [x] Completed | Import from Git, local, archive, wrapper generator in `packages/core` |
| Universal Extension Engine - MCP | [x] Completed | Multi-transport, diagnostics, tool discovery, Claude/Cursor import |
| Universal Extension Engine - Rules | [x] Completed | AGENTS.md, CLAUDE.md, Cursor rules, globs, precedence resolution |
| Universal Extension Engine - Plugins | [x] Completed | Inspection, manifest analysis, compatibility shims |
| Extension Security & Registry | [x] Completed | AST security scan, path traversal guard, persistent registry |
| Advanced Project Operations | [x] Completed | Create, rename, archive, restore, safe delete without disk purge |
| Dynamic Multi-Folder Workspaces | [x] Completed | Attach/detach roots, multi-drive, unified tree, relinking |
| Project Attachments System | [x] Completed | Multi-format, MIME categorization, text extraction, indexing |
| Multi-Conversation Management | [x] Completed | Multi-session per project, persistence, rename, archive |
| Server Handlers & Protocol APIs | [x] Completed | `server.extension` & `server.project` HttpApi endpoints in protocol & server |
| Client SDK Regeneration | [x] Completed | Regenerated typed client SDK in `packages/client` via `bun run generate` |
| Native Agent Tools | [x] Completed | `project_attachment`, `workspace_folder`, `universal_extension` tool plugins |
| UI Integration (App & Desktop) | [x] Completed | Universal Extension Center, Multi-Folder Explorer, Attachments Manager |
| Automated Test Suites | [x] Completed | 20 core unit tests passing, 235 desktop baseline tests passing |
| Documentation & Release Package | [x] Completed | ARCHITECTURE.md, COMPATIBILITY_MATRIX.md, SECURITY.md, CHANGELOG.md |

---

## Phase 1: Baseline Audit & Environment Setup (Completed)
- [x] Clone upstream official repository `https://github.com/anomalyco/opencode`.
- [x] Unshallow Git history and establish clean baseline on branch `universal-agent-ecosystem`.
- [x] Install Bun 1.4.4 according to repository `packageManager` specification.
- [x] Execute baseline `bun install` across all workspaces.
- [x] Fix Windows checkout symlink issue (`packages/app/src/custom-elements.d.ts`).
- [x] Verify baseline typecheck across core packages (`schema`, `core`, `protocol`, `server`, `client`, `cli`, `tui`, `app`, `desktop`, `plugin`).
- [x] Run baseline test suite (235/235 tests pass in desktop, unit tests pass in core).

---

## Phase 2: Schema Contracts & Extension Intermediate Representation (Completed)
- [x] Defined schemas in `packages/schema/src/extension.ts`:
  - `Platform`: "opencode" | "codex" | "claude" | "antigravity" | "cursor" | "custom".
  - `Category`: "skill" | "mcp" | "rule" | "plugin".
  - `CIR`: Common Intermediate Representation for Skills, MCP, Rules, Plugins.
  - `InstallInput`: Source URL/path, subpath, ref, targetScope, overrideName, expectedCategory.
  - `SecurityFinding` & `SecurityReport`: Severity, finding code, file, line, risk level.
  - `McpDiagnosticResult` & `McpToolDescriptor`: Live diagnostic and tool discovery descriptors.
- [x] Defined schemas in `packages/schema/src/project-workspace.ts`:
  - `WorkspaceFolder`: Multi-folder descriptor (id, projectID, path, name, isPrimary, vcs, status, addedAt).
  - `ProjectAttachment`: Persistent attachment descriptor (id, projectID, name, originalPath, storagePath, mimeType, category, size, extractedSummary, createdAt).
  - `ProjectConversation`: Persistent conversation descriptor (id, projectID, title, sessionID, messageCount, createdAt, updatedAt, archivedAt).
  - `CreateProjectInput`, `DeleteProjectInput`, `AddFolderInput`, `RemoveFolderInput`, `RelinkFolderInput`, `AddAttachmentInput`.
- [x] Re-exported all contracts in `packages/schema/src/index.ts`.

---

## Phase 3: Universal Agent Extension Compatibility Engine (Completed)
- [x] Security Engine (`packages/core/src/extension/security.ts`):
  - Path traversal prevention (`isPathSafe`).
  - AST / content regex scanner for dangerous shell execution, data exfiltration, hardcoded credentials.
  - Directory security auditor (`scanDirectory`) producing structured `SecurityReport`.
- [x] Platform Detectors (`packages/core/src/extension/detector.ts`):
  - Autodetects OpenCode, Claude Code, OpenAI Codex, Google Antigravity, Cursor.
- [x] Universal Skill Adapter (`packages/core/src/extension/skills/adapter.ts`):
  - Ingestion from GitHub repositories, subdirectories, local paths, and archives.
  - Structure preservation (scripts, references, assets).
  - Metadata normalization and `SKILL.md` wrapper generator.
  - Project vs Global installation scoping.
- [x] Universal MCP Manager (`packages/core/src/extension/mcp/manager.ts`):
  - Local STDIO and Remote HTTP/SSE transport validation.
  - Deep diagnostics engine (`testServer`) checking executable existence, latency, stderr, and tool discovery.
  - Configuration importers for Claude Desktop (`claude_desktop_config.json`) and Cursor.
- [x] Universal Rules & Instructions Adapter (`packages/core/src/extension/rules/adapter.ts`):
  - Parsers for `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`.
  - Scope, file-glob matching (`matchesGlob`), precedence resolution (lower number = higher priority).
- [x] Plugin Inspection & Adapter Shims (`packages/core/src/extension/plugin/adapter.ts`):
  - Manifest inspector, entrypoint and dependency analyzer.
  - Compatibility shim generator for external agent plugins.
- [x] Extension Registry (`packages/core/src/extension/registry.ts`):
  - Persistent registry storing CIR records in `.opencode/extensions.json` and global config.
  - Toggle (enable/disable), get, list, register, and safe remove operations.

---

## Phase 4: Advanced Project and Workspace Management (Completed)
- [x] Project Operations Service (`packages/core/src/workspace-manager/project.ts`):
  - Project creation, renaming, archiving, restoring.
  - Safe deletion (`deletePhysicalFiles: false` default) ensuring source code on disk is never deleted unless explicitly requested.
  - Project search by name and canonical directory.
- [x] Multi-Folder Workspace Manager (`packages/core/src/workspace-manager/multi-folder.ts`):
  - Dynamic folder attach and detach to existing projects.
  - Cross-drive, multi-repository support.
  - Primary root selection and relinking of missing paths.
  - Unified workspace explorer tree aggregator (`getUnifiedTree`).
- [x] Project Attachments Engine (`packages/core/src/workspace-manager/attachments.ts`):
  - Persistent storage in `.opencode/attachments/`.
  - MIME categorization (source, document, data, image, archive, other).
  - Content extractors for Text, Markdown, CSV, Code, and summaries.
  - Query search across attachment titles and extracted summaries.
- [x] Multi-Conversation Manager (`packages/core/src/workspace-manager/conversations.ts`):
  - Persistent multi-session per project coordinator.
  - Conversation listing, creation, renaming, archiving, restoring, and deletion.

---

## Phase 5: Protocol Endpoints, Server Handlers & Client SDK (Completed)
- [x] Protocol definitions in `packages/protocol/src/groups/`:
  - `extension.ts`: `extension.list`, `extension.install`, `extension.toggle`, `extension.remove`, `extension.mcp.test`.
  - `project.ts`: `project.list`, `project.create`, `project.update`, `project.delete`, `project.folders.list`, `project.folders.add`, `project.folders.remove`, `project.attachments.list`, `project.attachments.add`, `project.conversations.list`.
- [x] Protocol API Integration (`packages/protocol/src/api.ts`):
  - Registered `ExtensionGroup` into `makeApi` and `makeDefaultApi`.
- [x] Server handlers in `packages/server/src/handlers/`:
  - `extension.ts`: Handles extension list, git/local install, toggle, remove, and MCP diagnostic testing.
  - `project.ts`: Handles multi-folder listing, attach/detach, attachments list/add, conversations, and safe deletion.
- [x] Server routes (`packages/server/src/routes.ts` & `handlers.ts`):
  - Mounted `ProjectOperations.node`, `MultiFolderWorkspace.node`, `ProjectAttachments.node`, `ProjectConversations.node`, and `ExtensionRegistry.node` into `applicationServices`.
  - Added new services to request context via `Context.pick`.
- [x] Regenerated Client SDK:
  - Ran `bun run generate` in `packages/client`.
  - Generated typed client methods for `extension.*` and `project.*`.

---

## Phase 6: Native Agent Tools (Completed)
- [x] Created `packages/core/src/tool/plugin/attachment.ts`:
  - Native agent tool `project_attachment` for listing, reading, and searching project attachments.
- [x] Created `packages/core/src/tool/plugin/workspace-folder.ts`:
  - Native agent tool `workspace_folder` for listing attached directories and unified tree exploration.
- [x] Created `packages/core/src/tool/plugin/universal-extension.ts`:
  - Native agent tool `universal_extension` for querying installed extensions, platforms, and capabilities.
- [x] Registered tools in internal plugin pipeline (`packages/core/src/plugin/internal.ts`).

---

## Phase 7: UI & User Experience (Completed)
- [x] Universal Extension Center (`packages/app/src/settings/workspaces/project-extensions.tsx`):
  - Tabs for MCP Servers, Plugins, Skills, Rules, and LSPs.
  - Universal Skill Import Modal (Git URL, GitHub repo, local directory, zip archive) with platform detection and security audit report.
  - Live MCP Diagnostic Testing with latency and tool discovery display.
  - Rules & Instructions viewer for AGENTS.md, CLAUDE.md, and Cursor rules.
- [x] Multi-Folder Workspace Explorer (`packages/app/src/settings/workspaces/project-folders.tsx`):
  - Displays Primary canonical directory with badge.
  - Lists attached secondary folders from any location or drive.
  - Attach Folder dialog and safe Detach Folder action.
  - Relink Missing Folder modal.
- [x] Project Attachments Manager (`packages/app/src/settings/workspaces/project-attachments.tsx`):
  - File list with category badges (source, document, data, image, archive).
  - Search filter by title and extracted summary.
  - Add Attachment dialog with file path or direct content upload.
  - Preview modal for extracted text and summary.
- [x] Settings Shell Navigation (`packages/app/src/settings/shell.tsx` & `route.ts`):
  - Added `folders` and `attachments` tabs to project settings navigation.
  - Updated search index in `packages/app/src/settings/search-index.ts`.
