# Persistent memory and learning

opencode persists sessions and provides memory tools. Use them so work is not lost between chats.

## At the start of a non-trivial task
1. Use the `history` tool to search past sessions for relevant prior work on this project/topic.
2. Use the `memory` tool (action: search) to recall saved facts, decisions, and conventions.
3. Read `AGENTS.md` and `.opencode/state.md` if they exist.

## During long tasks (survive context compaction)
- Keep durable progress in `.opencode/state.md`: current goal, decisions made, files changed, next steps.
- Update it after each significant step so a compacted/restarted session can resume.

## When you learn something durable
Save it with the `memory` tool (action: write) or `memory_write`:
- Project conventions, build/test commands, architecture decisions.
- Fixes for recurring errors and their root cause.
- User preferences stated during the session.

This turns each session into accumulated knowledge instead of starting from zero.