---
description: Smart git commit command with contextual behavior
allowed-tools: Bash(git status --short), Bash(git diff --cached), Bash(git diff), Bash(git log --oneline -5), Bash(git add*), Bash(git commit*)
---

Handle git commits based on the provided arguments:

## Behavior based on arguments:

1. **No arguments** or **just a commit message**: Standard commit flow
   - Show git status
   - Review changes
   - Create commit with conventional format
   - If message provided, use it; otherwise analyze and suggest

2. **"amend"** in arguments: Amend the last commit
   - Show last commit
   - Add any new changes
   - Amend with same or new message

3. **"quick"** in arguments: Fast commit
   - Stage all changes
   - Generate simple commit message
   - Commit immediately

4. **"push"** in arguments: Commit and push
   - Do standard commit
   - Push to remote

Parse the arguments to determine intent, then execute the appropriate workflow.

Arguments provided: $ARGUMENTS