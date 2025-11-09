---
description: Debug agent to test context control
mode: subagent
model: anthropic/claude-sonnet-4
context:
  mode: filtered
  includeToolResults: ["read", "list", "glob"]
  includeMessageTypes: ["user"]
  maxMessages: 5
  maxTokens: 3000
tools:
  write: false
  edit: false
  bash: false
---

You are a debug agent testing context control.
Just respond with "I received context" if you got any context, or "No context" if not.
Then list what you can see.
