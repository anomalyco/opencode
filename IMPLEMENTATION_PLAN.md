# Implementation Plan: Enhanced OpenCode Universal Agent Ecosystem

## Project Status Overview

| Subsystem | Status | Verification |
|-----------|--------|--------------|
| Baseline Audit & Environment | [x] Completed | Git clean, Bun 1.4.4 installed, 235 desktop tests passing |
| Schemas & Type Contracts | [ ] In Progress | Universal extension CIR, multi-folder, attachment models |
| Universal Extension Engine - Skills | [ ] Pending | Import, detection, archive/git, wrapper generation |
| Universal Extension Engine - MCP | [ ] Pending | Multi-transport, diagnostics, tool discovery, configs |
| Universal Extension Engine - Rules | [ ] Pending | AGENTS.md, CLAUDE.md, Cursor rules, Antigravity |
| Universal Extension Engine - Plugins | [ ] Pending | Inspection, capability mapping, shims, adapters |
| Extension Security & Registry | [ ] Pending | Permission gating, scanner, rollback, storage |
| Advanced Project Operations | [ ] Pending | Create, rename, archive, restore, safe delete |
| Dynamic Multi-Folder Workspaces | [ ] Pending | Add/remove roots, multi-drive, unified tree |
| Project Attachments System | [ ] Pending | Multi-format, indexing, agent access tools |
| Multi-Conversation Management | [ ] Pending | Multi-session per project, persistence, resume |
| Server Handlers & Protocol APIs | [ ] Pending | REST/RPC endpoints, client SDK regeneration |
| UI Integration (App & Desktop) | [ ] Pending | Dedicated management panels, real backend wiring |
| Automated Test Suites | [ ] Pending | Unit, integration, and regression suites |
| Documentation & Release Package | [ ] Pending | Matrices, security docs, changelog, user guide |

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

## Phase 2: Schema Contracts & Extension Intermediate Representation
- [ ] Define schemas in `packages/schema/src/extension/`:
  - `cir.ts`: Common Intermediate Representation for Skills, MCP, Rules, Plugins.
  - `manifest.ts`: Universal manifest formats and metadata.
  - `security.ts`: Permission requests, risk levels, and inspection summaries.
  - `registry.ts`: Installed extension records, origins, and statuses.
- [ ] Define schemas in `packages/schema/src/project-workspace.ts`:
  - `workspace-folder.ts`: Folder descriptor (path, alias, drive, role, status).
  - `attachment.ts`: Attachment descriptor (id, name, mimeType, size, extractedText, tokens).
  - `project-extended.ts`: Enhanced project metadata with multi-folder and attachment support.

---

## Phase 3: Universal Agent Extension Compatibility Engine (Core)
- [ ] Platform Detectors (`packages/core/src/extension/detector.ts`):
  - Detect OpenCode, Claude Code, OpenAI Codex, Google Antigravity, Cursor.
- [ ] Universal Skill Adapter (`packages/core/src/extension/skills/`):
  - Ingestion from GitHub repos, subdirectories, local paths, and `.zip`/`.tar.gz` archives.
  - Structure preservation (scripts, references, assets).
  - Metadata normalization and `SKILL.md` wrapper generation.
  - Project vs Global installation manager.
- [ ] Universal MCP Manager (`packages/core/src/extension/mcp/`):
  - Local STDIO, Remote HTTP, and SSE transport handling.
  - Health check, live connection testing, and tool discovery.
  - Deep diagnostics engine (executable checks, env vars, stderr analysis).
  - Config importers for Claude Desktop and Cursor.
- [ ] Universal Rules & Instructions Adapter (`packages/core/src/extension/rules/`):
  - Parsers for `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`, Antigravity rules.
  - Scope, file-glob matching, precedence resolution.
  - Multi-source rule aggregator.
- [ ] Plugin Inspection & Adapter Shims (`packages/core/src/extension/plugin/`):
  - Manifest inspector, entrypoint and dependency analyzer.
  - Compatibility shim generator for foreign agent plugins.
- [ ] Security Engine & Extension Registry (`packages/core/src/extension/`):
  - Static security analyzer for untrusted extensions.
  - Permission grant model and transactional installation/rollback.

---

## Phase 4: Advanced Project and Workspace Management (Core)
- [ ] Project Operations Service (`packages/core/src/workspace-manager/project.ts`):
  - Project creation, renaming, archiving, restoring.
  - Safe deletion (metadata purge without filesystem destruction; explicit destructive mode).
- [ ] Multi-Folder Workspace Manager (`packages/core/src/workspace-manager/multi-folder.ts`):
  - Dynamic folder attach/detach to existing projects.
  - Cross-drive, multi-repository support.
  - Primary root selection and relinking of missing paths.
  - Unified workspace explorer tree aggregator.
- [ ] Project Attachments Engine (`packages/core/src/workspace-manager/attachments.ts`):
  - Persistent file storage and metadata tracking.
  - Content extractors for Text, Markdown, PDF, DOCX, CSV, Code, Archives.
  - Agent retrieval tools (`project_attachment_read`, `project_attachment_search`).
- [ ] Multi-Conversation Manager (`packages/core/src/workspace-manager/conversations.ts`):
  - Multi-session per project coordinator.
  - Shared project context and attachment access across conversations.

---

## Phase 5: Protocol Endpoints, Server Handlers & Client SDK
- [ ] Protocol definitions in `packages/protocol/src/groups/`:
  - `extension.ts`: Endpoints for inspect, install, uninstall, enable/disable, test-mcp, import-rules.
  - Update `project.ts`: Endpoints for create, delete, multi-folder management, attachments, and conversations.
- [ ] Server handlers in `packages/server/src/handlers/`:
  - `extension.ts`: Implement all extension protocol endpoints with core services.
  - Update `project.ts`: Implement multi-folder, attachment, and extended lifecycle handlers.
- [ ] Regenerate client SDK:
  - Run `bun run generate` from `packages/client`.

---

## Phase 6: User Interface (App & Desktop)
- [ ] Universal Extension Center (`packages/app/src/settings/extensions/`):
  - Tabs: Skills, MCP Servers, Rules, Plugins.
  - Status indicators (connected, error, disabled, pending).
  - One-click import wizard (Git URL, local directory, config file).
  - Diagnostic logs modal with live test results.
- [ ] Multi-Folder Workspace Explorer (`packages/app/src/workspaces/`):
  - Add / remove folder dialog.
  - Unified multi-folder file tree.
  - Relink missing folder UI.
- [ ] Project Attachments Panel:
  - Drag-and-drop file upload, preview, indexing status, deletion.
- [ ] Multi-Conversation Switcher & History:
  - Project conversations list, rename dialog, archive/delete controls.

---

## Phase 7: Verification, Automated Testing & Documentation
- [ ] Comprehensive unit and integration test suite:
  - Extension detectors and parsers.
  - Skill import from archives and directory trees.
  - MCP connection testing and diagnostics.
  - Rule precedence and glob matching.
  - Project multi-folder operations and safe deletion.
  - Attachment indexing and agent tool access.
- [ ] Regression testing against baseline OpenCode test suite.
- [ ] Finalize documentation: `COMPATIBILITY_MATRIX.md`, `SECURITY.md`, `TESTING.md`, `CHANGELOG.md`, `README.md`.
