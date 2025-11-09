---
description: Test context control with summary mode
mode: subagent
model: anthropic/claude-sonnet-4
context:
  mode: summary
  includeFileChanges: true
  maxTokens: 1000
tools:
  write: false
  edit: false
  bash: false
---

Based on the session summary, answer the question.
