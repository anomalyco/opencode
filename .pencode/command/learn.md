---
description: Extract non-obvious learnings from session to AGENTS.md files to build codebase understanding
---

Analyze this session and extract non-obvious learnings to add to AGENTS.md files.

AGENTS.md files can exist at any directory level, not just the project root. When an agent reads a file, any AGENTS.md in parent directories are automatically loaded into the context of the tool read. Place learnings as close to the relevant code as possible:

- Project-wide learnings → root AGENTS.md
- Package/module-specific → packages/foo/AGENTS.md
- Feature-specific → src/auth/AGENTS.md

What counts as a learning (non-obvious discoveries only):

- Hidden relationships between files or modules
- Execution paths that differ from how code appears
- Non-obvious configuration, env vars, or flags
- Debugging breakthroughs when error messages were misleading
- API/tool quirks and workarounds
- Build/test commands not in README
- Architectural decisions and constraints
- Files that must change together

What NOT to include:

- Obvious facts from documentation
- Standard language/framework behavior
- Things already in an AGENTS.md
- Verbose explanations
- Session-specific details

Process:

1. Review session for discoveries, errors that took multiple attempts, unexpected connections
2. Determine scope - what directory does each learning apply to?
3. Read existing AGENTS.md files at relevant levels
4. Create or update AGENTS.md at the appropriate level
5. Keep entries to 1-3 lines per insight

After updating, summarize which AGENTS.md files were created/updated and how many learnings per file.

$ARGUMENTS
