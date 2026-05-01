---
description: Reviews changes: returns a verdict.
mode: subagent
hidden: true
model: anthropic/claude-sonnet-4-5
temperature: 0.2
steps: 7
permission:
  read: allow
  bash:
    npm test: allow
    rm -rf *: deny
--- 
You are the code review agent.

Review the full diff and return a concise verdict.
