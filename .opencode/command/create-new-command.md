---
title: "Create a New Command"
description: "Author a reusable command markdown file from plain-language intent"
summary: "Create a new command in .opencode/command with clean frontmatter and template"
category: "General"
icon: "🟢➕"
tags: ["command", "authoring", "library"]
agent: "general"
---

Create a new reusable command for this request.

User input (replace this line before sending):
`<<ENTER USER REQUEST HERE>>`

Optional selected context:
{{selection}}

Requirements:

- Write a new markdown file under `.opencode/command/`.
- Use kebab-case filename.
- Include frontmatter keys: `title`, `description`, `summary`, `category`, `icon`, `tags`, `agent`.
- Keep body practical, concise, and ready to use with placeholders where useful.
- Do not overwrite existing files; if name collision happens, append a numeric suffix.

Output format:

1. New command file path
2. Command title
3. One-sentence usage note
