---
description: Test context control with filtered mode
mode: subagent
model: anthropic/claude-sonnet-4
context:
  mode: filtered
  includeToolResults: ["read"]
  maxTokens: 2000
tools:
  write: false
  edit: false
  bash: false
---

Summarize what you see very concisely.
List only the key points.
