---
title: "Create a New Agent"
description: "Author a new agent markdown file from role intent"
summary: "Create a new agent in .opencode/agent with clear specialization and operating rules"
category: "General"
icon: "🟢➕"
tags: ["agent", "authoring", "persona"]
agent: "general"
---

Create a new specialized agent for this request.

User input (replace this line before sending):
`<<ENTER USER REQUEST HERE>>`

Optional selected context:
{{selection}}

Requirements:

- Write a new markdown file under `.opencode/agent/`.
- Use kebab-case filename.
- Include frontmatter keys: `title`, `description`, `summary`, `category`, `icon`, `tags`, `mode`.
- Set `mode` to `all` unless the request clearly needs `subagent` or `primary`.
- Body must define role, operating expectations, output style, and boundaries.
- Do not overwrite existing files; if name collision happens, append a numeric suffix.

Output format:

1. New agent file path
2. Agent title
3. One-sentence usage note
