<!-- Context: openagents-repo/events | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# OpenCode Plugin Events

OpenCode fires over 25 events that you can hook into. These are categorized below:

## Command Events
- `command.executed`: Fired when a user or plugin runs a command.

## File Events
- `file.edited`: Fired when a file is modified via OpenCode tools.
- `file.watcher.updated`: Fired when the file watcher detects changes.

## Message Events (Read-Only)
- `message.updated`: Fired when a message in the session updates.
- `message.part.updated`: Fired when individual parts of a message update.
- `message.part.removed`: Fired when a part is removed.
- `message.removed`: Fired when entire message is removed.

## Session Events
- `session.created`: New session started.
- `session.updated`: Session state changed.
- `session.idle`: Session completed (no more activity expected).
- `session.status`: Session status changed.
- `session.error`: Error occurred in session.
- `session.compacted`: Session was compacted (context summarized).

## Tool Events (Interception)
- `tool.execute.before`: Fired before a tool runs. **Can block execution** by throwing an error.
- `tool.execute.after`: Fired after a tool completes with result.

## TUI Events
- `tui.prompt.append`: Text appended to prompt input.
- `tui.command.execute`: Command executed from TUI.
- `tui.toast.show`: Toast notification shown.

## Mapping from Claude Code Hooks

| Claude Hook | OpenCode Event |
|---|---|
| PreToolUse | tool.execute.before |
| PostToolUse | tool.execute.after |
| UserPromptSubmit | message.* events |
| SessionEnd | session.idle |
