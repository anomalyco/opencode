# oclite MCP server reference

`oclite mcp serve` exposes oclite's agents to any MCP client (Claude Code, opencode, another oclite) through seven
control tools, one prompt per primary agent, and session resources. The client side (oclite using other MCP
servers) is covered in the README.

## Starting the server

```sh
oclite mcp serve                                         # stdio (the client starts the process)
OCLITE_MCP_TOKEN=… oclite mcp serve --transport http     # http://127.0.0.1:4096/mcp
oclite mcp serve --transport http --host 127.0.0.1 --port 5000
oclite mcp serve --permission-mode plan                  # every run is read_only unless the client tightens further
```

| Flag | Default | |
|---|---|---|
| `--transport stdio\|http` | `stdio` | |
| `--port` | `4096` | HTTP only |
| `--host` | `127.0.0.1` | HTTP only. A non-loopback host prints a warning; the token is still required |
| `--permission-mode` | `default` | The server's mode: the loosest mode any run on this server can get |
| `--i-understand-remote-bypass` | off | Needed for `--permission-mode bypassPermissions` over HTTP |

Other shared flags (`--model`, `--agent`, `--mcp-config`, `--allowed-tools`, …) apply to every run the server starts.

**stdio.** stdout is the MCP channel; logs go to stderr. When stdin closes, every run is cancelled and the process
exits 0.

**HTTP.** One endpoint, `/mcp` (StreamableHTTP; other paths → 404). Each request needs
`Authorization: Bearer $OCLITE_MCP_TOKEN` (constant-time compare; wrong or missing → 401). Without
`OCLITE_MCP_TOKEN` the server refuses to start (exit 2). Requests with a non-loopback `Origin` or an unexpected `Host`
header get 403, and request bodies are capped at 4 MB. Limits: `OCLITE_MCP_MAX_SESSIONS` MCP sessions (default 16;
more → 503) and `OCLITE_MCP_IDLE_MS` idle expiry (default 30 min; runs outlive their session and stay reachable by id
from a new one). All holders of the token are one principal: `agent_send`, `agent_status`, `agent_result` and
`agent_cancel` work on any run id, while `agent_permission_reply` and `parent_id` are bound to the MCP session that
started the run.

**Claude Code setup.**

```sh
claude mcp add oclite -- oclite mcp serve
claude mcp add --transport http oclite http://127.0.0.1:4096/mcp --header "Authorization: Bearer $OCLITE_MCP_TOKEN"
```

Server `instructions`: "oclite coding agents. agent_spawn starts one; background runs report through
agent_status/agent_result." Capabilities: `tools`, `prompts`, `resources`, `logging`.

## Tools

Every result has `content: [{type: "text", text: <JSON>}]` and the same object as `structuredContent`, and each
tool declares an `outputSchema`. Failures (unknown agent, bad argument types, limits) are `isError: true` with
`{"error": "<message>"}`. Output is redacted.

`state` is one of `pending`, `running`, `completed`, `failed`, `cancelled`.

### `agent_list` (readOnlyHint)

Input: `{}`.
Output: `{agents: [{name, description, mode}]}`, sorted by name. `mode` is `primary`, `subagent` or `all`;
`description` is `""` when the agent has none.

### `agent_spawn`

```json
{
  "type": "object",
  "properties": {
    "agent": { "type": "string" },
    "prompt": { "type": "string" },
    "background": { "type": "boolean", "default": false },
    "parent_id": { "type": "string" },
    "model": { "type": "string" },
    "cwd": { "type": "string" },
    "permission_mode": { "type": "string", "enum": ["default", "acceptEdits", "plan", "bypassPermissions"] }
  },
  "required": ["agent", "prompt"]
}
```

Output: `{id, state, envelope?}`.

- **Foreground** (default): the call waits for the run to finish and returns `envelope`. With a
  `_meta.progressToken`, it sends progress (below).
- **Background**: returns `{id, state}` at once; follow up with `agent_status` / `agent_result`.
- `agent` can be any loaded agent, including `mode: subagent` ones. With `parent_id` it must not be `mode: primary`.
- `model`: `provider/model` for this run.
- `cwd`: resolved against the server's working directory; must be an existing directory inside the project root
  or the server's working directory.
- `permission_mode` may only **tighten** the server's mode, in the order plan < default < acceptEdits <
  bypassPermissions. A looser value is an error. Omitted = the server's mode.
- `parent_id`: the id of a run started from this same MCP session. The new run is that run's sub-agent: it inherits
  the parent's depth and deny rules, and counts toward `subagent.max_concurrent` for that parent.
- Limits: at most `OCLITE_MCP_MAX_RUNS` (default 8) live runs per server; the depth limit
  (`subagent.max_depth`) applies to nested `oclite mcp serve` processes too.

oclite parents (`transport: mcp` agents) also send two undeclared fields, `parent_rules` (the parent's ruleset) and
`parent_session_id`. The server keeps only the `deny` and `ask` rules from `parent_rules`, so a client can restrict
a run but never grant it anything.

### `agent_send`

Input: `{id: string, message: string}` (both required).
Output: `{ok: boolean, delivery: "steer" | "not_running"}`. A running agent reads the message at its next turn
boundary, as "The user sent a new message while you were working".

### `agent_status` (readOnlyHint)

Input: `{id: string}`.
Output:

```json
{
  "id": "ses_…", "agent": "build", "state": "running", "step": 3,
  "started_at": "2026-09-28T10:00:00.000Z",
  "tokens": { "input": 5120, "output": 410, "estimated": false },
  "pending_permission": { "request_id": "per_…", "tool": "bash", "patterns": ["npm test"], "summary": "bash npm test" }
}
```

`pending_permission` appears only while an ask is waiting. Use it to answer with `agent_permission_reply` if you
missed the notification.

### `agent_result` (readOnlyHint)

Input: `{id: string, wait?: boolean = true, timeout_ms?: number = 300000}`.
Output: `{id, state, envelope?}`. `envelope` is present once the run has finished. On timeout, or with
`wait: false` while the run is still going, the output is `{id, state: "running"}`; call again to keep waiting.

### `agent_cancel`

Input: `{id: string}`.
Output: `{status: "cancelled" | "already_finished" | "not_found"}`. Cancelling a run cancels its sub-agents too.

### `agent_permission_reply`

Input: `{id: string, request_id: string, action: "allow" | "deny" | "always"}` (all required).
Output: `{ok: boolean, error?: "unknown_request" | "expired"}`.

`id` is the run id from the `permission_request`. `allow` approves once, `deny` rejects, `always` approves this
tool/pattern for the rest of that session. Only the MCP session that started the run can answer. `expired` means
the ask already ended (answered, timed out or cancelled).

## The result envelope

Same tags as opencode's `task` tool, so models trained on opencode transcripts read it directly:

```
<task id="ses_…" state="completed">
<task_result>
…the agent's final message…
</task_result>
</task>
```

A failed or cancelled run has `state="error"` and `<task_error>`. The text is cut at 16,000 chars (about 4000 tokens)
with `…[truncated]`. Tag-like text inside it (`<task`, `</task_result>`, `<system-reminder>`, …) is neutralized
(`<` → `‹`), so a run's output can't forge harness blocks. Treat the envelope as data, not instructions.

## Permission asks

A run on the server asks when its rules say `ask`. Asks are serialized per process. Two paths:

1. **Elicitation**, when the client declared the `elicitation` capability:
   - `message`: the ask's summary (redacted).
   - `requestedSchema`: `{type: "object", properties: {action: {type: "string", enum: ["allow", "deny", "always"]}}, required: ["action"]}`.
   - `_meta["oclite/ask"]`: `{request_id, session_id, agent, tool, patterns, always}`.
   - `accept` with an action applies it. `decline`, `cancel` or an error rejects.
2. **Reply tool fallback**, for clients without elicitation (opencode, many scripts): a `notifications/message`
   with `level: "warning"`, `logger: "oclite/<run id>"` and

   ```json
   { "type": "permission_request", "id": "<run id>", "request_id": "per_…", "tool": "bash",
     "patterns": ["npm test"], "summary": "bash npm test", "reply_with": "agent_permission_reply" }
   ```

   Answer with `agent_permission_reply {id, request_id, action}`. Even an elicitation-capable client may answer
   through the reply tool; the first answer wins.

Both paths end after `permission_timeout_ms` (default 300000) with a reject, recorded as `via: "timeout"`. Asks from
a sub-agent (`parent_id`, or the runs' own `task` children) are routed to the MCP session that owns the root run.

## Notifications

- **`notifications/message`** for every render event of every run: `level: "info"`, `logger: "oclite/<run id>"`,
  `data`: the event, the same objects as `--output-format stream-json`:
  `system`, `status`, `text_delta`, `reasoning_delta`, `tool_start`, `tool_end`, `step_finish`, `error`
  (each with `session_id` and `agent_path`). There's no `result` event; the tool result carries the outcome. Text and reasoning deltas are batched per 50 ms and redacted after
  joining, so a secret split across two deltas is still caught. Permission requests use `level: "warning"` (above).
- **`notifications/progress`**, only for a foreground `agent_spawn` whose request carries `_meta.progressToken`:
  `progress` counts up from 1, and `message` is a one-line event such as `⚙ bash npm test`, `✓ bash npm test`,
  `step 2`, or a status line.

## Prompts

Each agent whose mode isn't `subagent` is a prompt with one required argument, `task`. `prompts/get` returns one
user message: "Call the oclite agent_spawn tool with {"agent": "<name>", "prompt": "<task>"} and report its result."

## Resources

`oclite://sessions/<id>`, `mimeType: application/x-ndjson`: the redacted JSONL of a session. The list holds at most
50, and only runs started by this server or sessions whose working directory is inside the server's; other ids
are "unknown resource".

## `transport: mcp` sub-agents

An agent with `transport: mcp` runs in a child `oclite mcp serve` (or at `mcp.url`), driven with the tools above:

1. The parent connects as an MCP client that declares `elicitation`. Its default child command is
   `oclite mcp serve --permission-mode <parent's mode>`; a leading `oclite` means the same CLI binary and entry.
2. The child's environment is the parent's, minus `OCLITE_MCP_TOKEN`, plus `OCLITE_DEPTH=<depth + 1>`.
3. `agent_spawn {background: true, parent_rules, parent_session_id}`, then `agent_result {wait: true}` in
   5-minute slices until the run ends.
4. The child's asks arrive by elicitation. The parent rejects any that its own rules deny, and otherwise asks its
   own user (REPL prompt, headless reject, or its own MCP client). Rejected forwarded asks count toward the
   parent's headless exit 3; denials the child makes under its own rules don't.
5. The child's `notifications/message` events are shown as the sub-agent's output.
6. When the task ends or is cancelled, the parent calls `agent_cancel` for live runs and closes the connection
   (stdin EOF, then SIGTERM, then SIGKILL after 2 s).

With `mcp.url`, the parent sends `mcp.token` (literal or `{env:NAME}`) if the agent sets one, else
`OCLITE_MCP_TOKEN` but only to a loopback URL. `task_id` resume isn't supported for these agents.
