# Command Library Guide

This folder is the source of truth for reusable Library commands.

- Commands are loaded from `.opencode/command/**/*.md`.
- Each command file is markdown with frontmatter + body.
- The file body becomes the command template inserted into the composer.

## Command schema

Supported frontmatter fields:

- `title` (optional): human-readable display name in Library UI
- `description` (optional): concise usage description
- `summary` (optional): secondary line in lists/tooltips
- `category` (optional): grouping label (for example `Code Review`, `AI`)
- `icon` (optional): emoji/icon marker shown in lists
- `tags` (optional): string array used by search
- `agent` (optional): default agent to pair with this command
- `model` (optional): explicit model override (provider/model id)
- `subtask` (optional): marks command as subtask-oriented

Required command content:

- Markdown body text is required and becomes `template`.

## Example

```md
---
title: "Deep Code Review"
description: "Thorough review for correctness and maintainability"
summary: "Production-critical review pass"
category: "Code Review"
icon: "🔎"
tags: ["review", "quality"]
agent: "code-review"
---

Review the current branch against `dev`.

Return:

1. Critical issues
2. Medium issues
3. Quick wins
4. Recommended patch plan
```

## Naming and compatibility

- Use kebab-case file names (for example `deep-code-review.md`).
- Nested folders are supported (for example `ai/ai-model-routing-strategy.md`).
- Nested commands keep path-style names.
- Backward-compatible flat aliases are added when the leaf name is unique.
  - Example: `ai/ai-model-routing-strategy` also resolves as `ai-model-routing-strategy`.
  - If two files share the same leaf name, no flat alias is added.

## Create commands from the UI

In Desktop Library:

1. Open **Library**.
2. Scroll to the bottom actions.
3. Click **Create a New Command**.
4. Replace the input placeholder in the inserted template.
5. Send, review generated file, and adjust as needed.

Prompt snippet (replace the highlighted line):

```text
User input (replace this line before sending):
<<ENTER USER REQUEST HERE>>
```

## Authoring tips

- Keep templates practical and execution-focused.
- Prefer explicit output structure (sections/checklists/tables).
- Keep category and icon consistent within a domain pack.
- Use tags users will actually search for.
