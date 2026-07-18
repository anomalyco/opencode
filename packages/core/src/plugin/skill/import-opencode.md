<!--
  Built-in skill. Name and description are registered in code at
  packages/core/src/plugin/skill.ts and packages/kancode/src/skill/index.ts.
  The body below becomes the skill's content.
-->

# Import OpenCode project content into KanCode

KanCode no longer loads project `.opencode/` at runtime. Project config lives
under **`.kancode/`** (and root `kancode.json` / `kancode.jsonc`). Use this
skill when the user wants to migrate selected content from an existing
`.opencode/` directory into `.kancode/`.

## When to use

- The project (or user home, if they ask) still has `.opencode/` with skills,
  commands, agents, themes, or plans.
- The user asks to import, migrate, copy, or move OpenCode config content into
  KanCode.

Do **not** use this skill for editing application source code unrelated to
KanCode/OpenCode configuration.

## Categories the user may choose

Ask which categories to import (multi-select). Only these are in scope:

| Category | Source under `.opencode/` | Destination under `.kancode/` |
| -------- | ------------------------- | ----------------------------- |
| skills   | `skill/` or `skills/`     | same relative layout          |
| commands | `command/` or `commands/` | same relative layout          |
| agents   | `agent/` or `agents/`     | same relative layout          |
| themes   | `themes/`                 | `themes/`                     |
| plans    | `plans/`                  | `plans/`                      |

Out of scope for this skill (do not import unless the user explicitly asks in
a separate task): `opencode.json` / `kancode.json`, `tui.json`, plugins,
modes, tools, `node_modules`, lockfiles.

## Workflow

1. Resolve the source directory:
   - Default: `<project-root>/.opencode` (walk up from the workspace if needed).
   - If the user asks for home/global content, use `~/.opencode` only when they
     explicitly request it (KanCode does not auto-discover it).
2. If `.opencode/` is missing, tell the user and stop.
3. Ask which categories to import from the table above.
4. For each chosen category, list concrete entries found (skill names, command
   markdown files, agent files, theme JSON files, plan markdown files).
5. Let the user confirm **all** or a **subset** per category.
6. Create `.kancode/` (and subdirs) as needed. Copy files preserving relative
   paths (e.g. `.opencode/skills/foo/SKILL.md` → `.kancode/skills/foo/SKILL.md`).
7. On name collision with an existing file under `.kancode/`, ask before
   overwrite. Never silently overwrite.
8. Summarize what was copied and what was skipped.
9. Remind the user that KanCode only reads `.kancode/` (and root
   `kancode.json(c)`) going forward; they can delete `.opencode/` after they
   are satisfied, or keep it as an unused archive.

## Tips

- Prefer copying over moving unless the user asks to delete the source.
- After import, suggest restarting KanCode so newly copied skills/commands/
  agents/themes are picked up.
- For KanCode config shape help after import, use the `customize-opencode`
  skill (paths there refer to `.kancode/` / `kancode.json`).
