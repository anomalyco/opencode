# Testing and Verification Strategy

## 1. Baseline Test Audit

Before any modifications, the existing OpenCode upstream test suite was audited:

- **Environment**: Windows 11 x64, Node.js v22.21.0, Bun 1.4.4.
- **Repository Branch**: `dev` tracking `origin/dev` at commit `2e29481d5c5b92b75b6a29eeca8a8ff8ed166af7`.
- **Baseline Test Results**:
  - `packages/desktop`: **235 pass, 0 fail** across 40 test files (`bun test`).
  - `packages/core/test/skill-discovery.test.ts`: **7 pass, 0 fail**.
  - `packages/core/test/workspace.test.ts`: **21 pass, 0 fail**.
  - `packages/core/test/skill.test.ts`: **9 pass, 0 fail**.
  - `packages/core/test/instructions/index.test.ts`: **14 pass, 0 fail**.
  - `packages/core/test/instructions/builtins.test.ts`: **3 pass, 0 fail**.
  - `packages/core/test/plugin/skill.test.ts`: **2 pass, 0 fail**.
- **Typecheck Baseline**:
  - `packages/core`: **0 type errors** in 1,855 files (`bun typecheck`).
  - `packages/server`: **0 type errors** in 1,466 files (`bun typecheck`).
  - `packages/desktop`: **0 type errors** in 2,954 files (`bun typecheck`).
  - `packages/app`: **0 type errors** in 1,895 files (`bun typecheck`).
  - `packages/cli`: **0 type errors** in 2,034 files (`bun typecheck`).
  - `packages/tui`: **0 type errors** in 1,827 files (`bun typecheck`).
  - `packages/schema`: **0 type errors** in 127 files (`bun typecheck`).
  - `packages/protocol`: **0 type errors** in 148 files (`bun typecheck`).
  - `packages/plugin`: **0 type errors** in 316 files (`bun typecheck`).
  - `packages/client`: **0 type errors** in 175 files (`bun typecheck`).

---

## 2. Test Suites for Enhanced Capabilities

All new subsystems are accompanied by automated tests:

### Universal Agent Extension Compatibility Tests:
1. **Platform Detection & Manifest Parsing**:
   - Detection of OpenCode, Claude Code, OpenAI Codex, Antigravity, Cursor extensions.
   - Parsing of YAML/frontmatter, JSON manifests, and `.mdc` rules.
2. **Universal Skill Importer & Adapter**:
   - Ingestion of multi-file skills with nested `scripts/` and `references/`.
   - Transformation of non-OpenCode skills into standard formats.
   - Archive extraction (`.zip`, `.tar.gz`) and directory safety validation.
   - Collision detection and provenance tracking.
3. **MCP Manager & Diagnostics**:
   - Connection validation for local STDIO and remote HTTP transports.
   - Diagnostic error reporting when executables or paths are invalid.
   - Import of Claude Desktop and Cursor configurations.
4. **Universal Rules & Precedence**:
   - Parsing of `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and `.cursor/rules/*.mdc`.
   - File glob matching and scope evaluation.
   - Conflict resolution without rule loss.
5. **Security & Rollback**:
   - Path traversal rejection.
   - Reversible transactional installation and rollback on failure.

### Advanced Project & Workspace Management Tests:
1. **Project Operations**:
   - Project creation, renaming, archiving, and restoration.
   - Safe deletion ensuring source folders remain untouched on disk.
2. **Multi-Folder Workspaces**:
   - Adding and removing multiple folders across independent directories.
   - Relinking moved or missing folders.
   - Unified folder tree generation.
3. **Project Attachments**:
   - Ingestion of various file types (text, markdown, pdf, docx, csv, images).
   - Metadata and text extraction indexing.
   - Agent tool access without context duplication.
4. **Multi-Conversation Persistence**:
   - Multiple independent sessions linked to a project.
   - Session renaming, archiving, and resumption across restarts.

---

## 3. Regression Testing

Every milestone must maintain zero regressions in existing OpenCode tests and typechecks:
```bash
# Verify packages individually (as per OpenCode contributing guidelines):
cd packages/core && bun test && bun typecheck
cd packages/desktop && bun test && bun typecheck
cd packages/app && bun typecheck
```
