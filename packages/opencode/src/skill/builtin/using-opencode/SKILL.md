---
name: using-opencode
description: Use this before creating or editing OpenCode skills, commands, agents, plugins, or config so you can confirm the official OpenCode docs and file locations first.
---

# Using OpenCode

Use this when the task is about OpenCode itself rather than the user's app code.

Typical triggers:

- creating or editing an OpenCode `skill`
- creating or editing an OpenCode `command`
- creating or editing an OpenCode `agent`
- creating or editing an OpenCode `plugin`
- deciding where OpenCode-owned files should live
- checking whether project-level or global configuration is the better fit

Before you make changes, look up the current OpenCode docs and verify the expected location and format.

Docs to check first:

- Skills: `https://opencode.ai/docs/skills`
- Commands: `https://opencode.ai/docs/commands`
- Agents: `https://opencode.ai/docs/agents`
- Plugins: `https://opencode.ai/docs/plugins`
- Config and directory conventions: `https://opencode.ai/docs/config`

While reading the docs, confirm these points before editing files:

1. Whether the object should live in the project or global config.
2. Which directory name is canonical (`skills` vs `skill`, `commands` vs `command`, `agents` vs `agent`).
3. What file format is expected (`SKILL.md`, markdown command file, markdown agent file, plugin source file, etc.).
4. Whether there is a minimum frontmatter or schema requirement.

Default behavior after checking the docs:

- Use the canonical OpenCode location when the docs are explicit.
- If the directory does not exist, create the minimum required structure.
- Prefer project-local paths when the user is asking for repo-specific behavior, unless they explicitly ask for a global install.
- If the docs and repository conventions disagree, mention the mismatch and follow the user's request.

Do not guess OpenCode-specific paths when the docs can answer the question.
