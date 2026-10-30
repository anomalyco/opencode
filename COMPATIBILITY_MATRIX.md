# Compatibility Matrix: Universal Agent Ecosystem

This document details the support, format mappings, and adaptation strategies for extensions across major AI agent ecosystems.

| Ecosystem | Category | Source Format | Target Format / Handling | Adaptation Strategy | Status |
|-----------|----------|---------------|--------------------------|---------------------|--------|
| **OpenCode** | Skill | `SKILL.md` (frontmatter: name, description) | Native `Skill.Info` | Direct native load | Full |
| **OpenCode** | MCP | `opencode.json` / STDIO / Remote | Native `Mcp.ServerConfig` | Direct native load | Full |
| **OpenCode** | Rule | `AGENTS.md` | Native Instructions | Direct native load | Full |
| **OpenCode** | Plugin | `@opencode/plugin` JS/TS package | Native Plugin | Direct native load | Full |
| **Claude Code** | Skill | `.claude/skills/*`, prompt bundles | OpenCode `SKILL.md` + dir | Frontmatter extraction, script wrapping | Adapted |
| **Claude Code** | MCP | `claude_desktop_config.json` | OpenCode MCP config | Direct schema translation (STDIO/SSE/HTTP) | Full |
| **Claude Code** | Rule | `CLAUDE.md`, `.claude/rules` | OpenCode Instructions | Format preservation, priority mapping | Full |
| **Claude Code** | Plugin | Claude MCP tool packs | OpenCode MCP / Plugin shim | Wrapper registration | Adapted |
| **OpenAI Codex** | Skill | Codex skill JSON / markdown instructions | OpenCode `SKILL.md` | Schema translation, parameter mapping | Adapted |
| **OpenAI Codex** | MCP | Codex custom tool definitions | MCP stdio bridge / tool shim | Adapter generator | Adapted |
| **OpenAI Codex** | Rule | `instructions.md`, system instructions | OpenCode Instructions | Scope preservation | Full |
| **Google Antigravity** | Skill | `SKILL.md` + scripts + references + resources | OpenCode `SKILL.md` multi-file bundle | Preserves nested files, formats YAML frontmatter | Full |
| **Google Antigravity** | MCP | `mcp_servers.json` / lazy schemas | OpenCode MCP config | Translates STDIO/HTTP endpoints | Full |
| **Google Antigravity** | Rule | `AGENTS.md`, sidecar rules, plugin rules | OpenCode Instructions | Precedence mapping, scope matching | Full |
| **Google Antigravity** | Plugin | Antigravity plugin bundle (skills, rules, MCP) | Composite OpenCode extension | Unpacks and registers components individually | Full |
| **Cursor** | Rule | `.cursorrules` (legacy) | OpenCode Instructions | Ingested at project root scope | Full |
| **Cursor** | Rule | `.cursor/rules/*.mdc` (frontmatter: description, globs, alwaysApply) | OpenCode Instructions with Glob Filter | Preserves glob file patterns and triggers | Full |
| **Cursor** | MCP | Cursor settings MCP section | OpenCode MCP config | Schema conversion to OpenCode format | Full |

---

## Adaptation Strategies Breakdown

### 1. Skills Transformation
- **Input Detection**: Inspects whether the source directory contains `SKILL.md`, `.claude/skills`, `package.json`, or raw `.md` files.
- **Directory Structure**: Retains `scripts/`, `references/`, `assets/`, and secondary files intact.
- **Frontmatter Reconciliation**: Normalizes metadata (`name`, `description`, `disable-model-invocation`, `autoinvoke`, `permissions`).
- **Invocation Shims**: When external scripts rely on specific environment variables (e.g. `CLAUDE_PROJECT_DIR`, `CODEX_ROOT`), a runtime shim injects the corresponding OpenCode workspace variables.

### 2. MCP Configuration Translation
- Translates `mcpServers` object from Claude Desktop / Cursor formats:
  ```json
  // Claude Desktop Config:
  {
    "mcpServers": {
      "sqlite": {
        "command": "uvx",
        "args": ["mcp-server-sqlite", "--db-path", "test.db"],
        "env": { "DEBUG": "1" }
      }
    }
  }
  ```
  Converts to OpenCode `LocalConfig`:
  ```json
  {
    "type": "local",
    "command": ["uvx", "mcp-server-sqlite", "--db-path", "test.db"],
    "environment": { "DEBUG": "1" }
  }
  ```

### 3. Rules & Context Precedence
When multiple rule sources are present, precedence is applied deterministically:
1. **Project-level specific file-matching rules** (e.g., Cursor `.mdc` rules matching active file path).
2. **Project-level root instructions** (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`).
3. **Subdirectory scoped instructions** (`sub/AGENTS.md`).
4. **Global instructions** (`~/.config/opencode/AGENTS.md`).
5. **System built-in instructions**.

No rules are silently discarded. When overlapping instructions are merged, sources are credited in the rendered model instructions.
