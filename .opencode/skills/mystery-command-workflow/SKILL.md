---
name: mystery-command-workflow
description: Execute a fixed, command-only mystery-analysis workflow. Use when the user asks for /import, /chapters, /select, /selected, /analyze, /export, /check, /graphs, /status, /help, or /quit behavior without free-form prompting.
---

# Mystery Command Workflow

Run the fixed command pipeline and avoid free-form prompts.

## Workflow

1. Run import and indexing:
- `/import <path>`
- `/chapters`

2. Choose scope:
- `/select <range>`
- `/selected`

3. Analyze:
- `/analyze`
- `/analyze --only people|events|clues|foreshadows|threads|hypotheses`
- `/analyze --force`

4. Export and validate:
- `/graphs`
- `/export obsidian`
- `/check`
- `/status`

## Rules

- Accept only slash commands in this workflow.
- Reject non-command text with: `This build is command-only. Type /help.`
- Keep output concise and deterministic.

## References

Use `references/workflow.md` for the command playbook and output checks.
