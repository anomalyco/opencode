# Agent Library Guide

This folder defines agent profiles used by the Library and composer.

- Agents are loaded from `.opencode/agent/**/*.md`.
- Each agent file is markdown with frontmatter + body.
- The body becomes the agent prompt/instruction block.

## Agent schema

Supported frontmatter fields:

- `title` (optional): human-readable display name
- `description` (optional): concise role description
- `summary` (optional): secondary line for pickers/tooltips
- `category` (optional): grouping label
- `icon` (optional): emoji/icon marker
- `tags` (optional): string array used by search
- `mode` (optional): `all`, `primary`, or `subagent`
- `model` (optional): explicit model override (provider/model id)
- `variant` (optional): model variant hint
- `temperature` (optional): model temperature
- `top_p` (optional): model top-p
- `steps` (optional): max agentic iterations
- `hidden` (optional): hide subagent from pickers
- `color` (optional): hex or theme color token
- `permission` (optional): tool permission ruleset
- `options` (optional): extra arbitrary options
- `disable` (optional): disable this agent definition

Required agent content:

- Markdown body text is required and becomes `prompt`.

## Example

```md
---
title: "Code Review"
description: "High-signal reviewer for production changes"
summary: "Find critical correctness and reliability issues first"
category: "Code Review"
icon: "🔎"
tags: ["review", "quality", "risk"]
mode: "all"
---

You are a principal code reviewer.

Prioritize correctness, reliability, and security.
Return concise findings with exact file/function references and practical fixes.
```

## Naming and compatibility

- Use kebab-case file names (for example `code-review.md`).
- Keep instructions scoped, clear, and action-oriented.
- Backward-compatible aliases are supported:
  - `docs` -> `documentation`
  - `planning` -> `plan`
  - `triage` -> `troubleshooting`

## Create agents from the UI

In Desktop Library:

1. Open **Library**.
2. Scroll to the bottom actions.
3. Click **Create a New Agent**.
4. Replace the input placeholder in the inserted template.
5. Send, review generated file, and refine role boundaries.

Prompt snippet (replace the highlighted line):

```text
User input (replace this line before sending):
<<ENTER USER REQUEST HERE>>
```
