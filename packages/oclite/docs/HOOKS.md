# oclite hooks reference

Hooks run a shell command at fixed points of a run. The contract follows Claude Code's, so most Claude hooks port
over, with the differences listed at the end.

## Events

| Event | When | Exit 2 means |
|---|---|---|
| `PreToolUse` | After the permission check passes, before the tool runs | The tool doesn't run. The model gets `blocked: <stderr>` as the tool result (status `blocked`) |
| `PostToolUse` | After the tool succeeded and its output was truncated (not after a failed or timed-out call) | The call can't be undone; stderr is appended to the output as `<hook>…</hook>` for the model |
| `Stop` | The model ended a turn with no tool calls and no background sub-agents are still running | The run doesn't end: stderr goes into a `<system-reminder>` ("A Stop hook blocked ending the turn: …") and the model continues |

Hooks cover every tool the model calls: built-ins, `task`, `tool_search` and MCP tools. A tool call that the
permission system denies never reaches `PreToolUse`.

## Config

Both shapes are accepted in the same list, in any config layer:

```jsonc
{
  "hooks": {
    "PreToolUse": [
      // oclite shape: timeout in milliseconds
      { "matcher": "bash", "command": "./scripts/deny-prod.sh", "timeout": 5000 }
    ],
    "PostToolUse": [
      // Claude Code shape: timeout in seconds
      { "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "bun run fmt", "timeout": 30 } ] }
    ],
    "Stop": [
      { "command": "./scripts/tests-pass.sh" }
    ]
  }
}
```

| Field | Meaning |
|---|---|
| `matcher` | Glob over the oclite tool name, case-insensitive, `\|`-separated alternatives. Empty or missing = `*`. Ignored for `Stop` |
| `command` | Run with `sh -c` in the session's working directory |
| `timeout` | oclite shape: ms. Claude shape: seconds. Default 10 s |
| `hooks[].type` | Only `"command"` runs. Other types (e.g. Claude's `prompt`) are skipped with a notice |

Lists from the user and project configs are **not** concatenated: `hooks` merges like any object, so a project
`PreToolUse` list replaces the user one. Hooks in an untrusted project config are ignored (see
[CONFIG.md](CONFIG.md#project-trust)).

Tool names to match: `bash`, `read`, `write`, `edit`, `glob`, `grep`, `webfetch`, `todowrite`, `skill`, `task`,
`tool_search`, `mcp__<server>__<tool>`. Claude names such as `Bash`, `Read`, `Edit|Write` match because matching is
case-insensitive. `MultiEdit` doesn't match anything (oclite has no such tool); use `edit`. `mcp__github__*` matches
every tool of the `github` server.

## Input (stdin)

One JSON object:

```json
{
  "hook": "PreToolUse",
  "hook_event_name": "PreToolUse",
  "session_id": "ses_…",
  "tool_name": "edit",
  "tool_input": { "filePath": "src/app.ts", "oldString": "a", "newString": "b" },
  "tool_output": "…",
  "cwd": "/path/to/project"
}
```

- `tool_input` is the decoded tool input, with **opencode's parameter names** (`filePath`, `oldString`,
  `newString`, `replaceAll`, `command`, `timeout`, `workdir`, `pattern`, `path`, `include`, `url`, …).
- `tool_output` is present only in `PostToolUse`: the text the model will see (after truncation).
- `Stop` has no `tool_name`, `tool_input` or `tool_output`.

## Output and exit codes

| Exit | Effect |
|---|---|
| 0 | Continue. stdout is ignored |
| 2 | Block (see the table above). stderr is the reason; empty stderr becomes `blocked by hook "<command>"` |
| anything else | Warn and continue. oclite prints `hook "<command>" exited with code N: <stderr>` as a notice |
| timeout | Warn and continue: `hook "<command>" timed out after N s`. The hook's whole process group is killed |

Entries for one event run in order; the first block wins and later entries don't run. Warnings from several
entries are joined. Cancelling the run (Ctrl-C) kills a running hook.

## Environment

Hooks inherit oclite's environment, except `OCLITE_MCP_TOKEN`, and nothing more. There's no `CLAUDE_PROJECT_DIR`;
use `cwd` from stdin.

## Example: block pushes to main

```sh
#!/bin/sh
# scripts/deny-prod.sh (PreToolUse, matcher "bash")
cmd=$(jq -r '.tool_input.command // ""')
case "$cmd" in
  *"git push"*main*) echo "pushing to main is not allowed from the agent" >&2; exit 2 ;;
esac
exit 0
```

## Differences from Claude Code hooks

- Only `PreToolUse`, `PostToolUse` and `Stop`; no `UserPromptSubmit`, `SessionStart`, `Notification`,
  `SubagentStop` or `PreCompact`.
- Only exit codes are read. JSON on stdout (`decision`, `permissionDecision`, `continue`, …) is ignored.
- `tool_name` is oclite's lowercase name and `tool_input` uses opencode's parameter names (`filePath`, not
  `file_path`), so scripts that read `.tool_input.file_path` need updating.
- A hook can't approve a tool call; it can only block one. Approval stays with the permission system.
