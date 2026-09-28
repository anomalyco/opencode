# oclite

oclite is a small, fast coding-agent CLI in the style of Claude Code, built from opencode's model layer and utilities.
It talks to hosted models (Anthropic, OpenAI) and to local openai-compatible servers (vLLM, llama.cpp, …), with
token-lean profiles for small local models. MCP is its main contract: it's an MCP client, an MCP server, and a sub-agent transport.

More detail: [docs/CONFIG.md](docs/CONFIG.md) (every config field), [docs/MCP.md](docs/MCP.md) (server tool
schemas and notifications), [docs/HOOKS.md](docs/HOOKS.md) (hooks).

## Quickstart

### Install and run from the monorepo

```sh
git clone <this repo> opencode-dev && cd opencode-dev
bun install
bun packages/oclite/src/index.ts --help
```

The package declares an `oclite` bin (`packages/oclite/src/index.ts`), but `bun install` doesn't put it on your
PATH. A small wrapper does:

```sh
mkdir -p ~/.local/bin
printf '#!/bin/sh\nexec bun "%s/packages/oclite/src/index.ts" "$@"\n' "$PWD" > ~/.local/bin/oclite
chmod +x ~/.local/bin/oclite     # make sure ~/.local/bin is on PATH
oclite --version
```

The rest of this README writes `oclite`; `bun packages/oclite/src/index.ts` works the same everywhere.

### Hosted Anthropic

The default model is `anthropic/claude-sonnet-5`. The key comes from `ANTHROPIC_API_KEY` (or `provider.anthropic.options.apiKey`).

```sh
export ANTHROPIC_API_KEY=sk-ant-...
oclite                                        # interactive REPL
oclite -p "summarize what src/ does"          # one shot
oclite --model openai/gpt-5 -p "…"            # openai/<model> reads OPENAI_API_KEY
```

### A local openai-compatible server

Point a provider at the server's `/v1` base URL. The provider id (`local` here) is your choice; the model id must
be the one the server serves. Put this in `.oclite/config.json` in your project (or `~/.config/oclite/config.json`):

```jsonc
{
  "model": "local/qwen3-coder",
  "provider": {
    "local": {
      "options": { "baseURL": "http://127.0.0.1:8000/v1" },     // apiKey is optional for local servers
      "models": { "qwen3-coder": { "limit": { "context": 32768, "output": 4096 } } }
    }
  },
  // Optional: pin what you already know, so the probe doesn't have to guess (see "What you'll see and why").
  "servers": {
    "http://127.0.0.1:8000/v1": { "capabilities": { "tools_native": true, "prefix_cache": true } }
  }
}
```

```sh
oclite debug server        # what the capability probe found, and where each value came from
oclite debug prompt --tokens   # fixed per-request overhead, as the server counts it
oclite -p "list the files in src"
```

A loopback base URL (`localhost`, `127.*`, `::1`) selects the `local` profile automatically (see Profiles).

### `-p` and the three output formats

```sh
oclite -p "list files"                               # text: answer on stdout; status, tools, reasoning on stderr
oclite -p "list files" --output-format json          # one JSON object at the end (the result event)
oclite -p "list files" --output-format stream-json   # one JSON event per line as it happens
```

`json` prints `{"type":"result","session_id",…,"state","text","turns","usage","exit_code"}` plus `errors` when
there were any. `stream-json` emits `system`, `status`, `text_delta`, `reasoning_delta`, `tool_start`, `tool_end`,
`step_finish`, `result` and `error` events. Every event has `session_id` and `agent_path` (sub-agent nesting).
Headless runs can't answer permission prompts: every `ask` is rejected and the run exits 3 at the end (see
Security notes). Use `--allowed-tools` or `--permission-mode` to pre-approve.

## CLI reference

| Command | Flags / arguments | What it does |
|---|---|---|
| `oclite` | shared flags | Interactive REPL (readline, streaming output; no TUI) |
| `oclite -p "<prompt>"` | shared flags | One prompt, non-interactive |
| `oclite mcp serve` | `--transport stdio\|http` (stdio), `--port` (4096), `--host` (127.0.0.1), `--i-understand-remote-bypass` | Expose oclite agents as an MCP server |
| `oclite mcp add <name> <url>` / `oclite mcp add <name> -- <cmd> [args…]` | `-t, --transport stdio\|http\|sse`, `-s, --scope project\|user` (project), `-e, --env KEY=value`, `-H, --header "Name: value"`, `--timeout <ms>` | Add a server to the `mcp` block of `<root>/.oclite/config.json` or `~/.config/oclite/config.json` |
| `oclite mcp list` | `--check` (connect and show live status) | List configured MCP servers |
| `oclite mcp get <name>` | | Show one server (redacted) |
| `oclite mcp remove <name>` | `-s, --scope project\|user` (both, project first) | Remove a server |
| `oclite mcp auth <name>` | | OAuth browser flow for a remote server |
| `oclite agents list` / `agents show <name>` | | Inspect loaded agents |
| `oclite debug prompt` | `--tokens` (ask the server), `--check` (exit 1 if over budget) | Composed system prompt, per-tool sizes, fixed overhead |
| `oclite debug server` | `--reprobe` | Capability record for the current provider/model |
| `oclite session list` / `show <id>` / `export <id>` | | Sessions for this directory; transcript; raw JSONL |
| `oclite trust [path]` | `--yes` (record without asking) | Show what a project's config sets, and trust it (Security notes) |

Shared flags (accepted by every command):

| Flag | Meaning |
|---|---|
| `-p, --print <prompt>` | Run one prompt and exit |
| `--output-format text\|json\|stream-json` | Default `text`. `agents`, `mcp list`, `session`, `debug` also print JSON with `json` |
| `--agent <name>` | Primary agent (default `build`, or config `default_agent`) |
| `--model <provider/model>` | Overrides config `model` (an agent's own `model:` still wins for that agent) |
| `--profile default\|local\|local-min` | Force a profile (default: automatic) |
| `--mcp-config <file or JSON>` | Extra MCP servers, `{mcp}` or Claude `{mcpServers}` shape; repeatable |
| `--strict-mcp-config` | Ignore `mcp` from config files; only `--mcp-config` servers |
| `--allowed-tools "<rules>"` / `--disallowed-tools "<rules>"` | Allow/deny rules, e.g. `"read,bash(git *),Bash(npm test:*),mcp__github__*"`; repeatable |
| `--permission-mode default\|acceptEdits\|plan\|bypassPermissions` | See Security notes |
| `--max-turns <n>` | Stop after n model turns (exit 3) |
| `-c, --continue` / `-r, --resume <id>` | Continue the latest session in this directory / a given session |
| `--append-system-prompt "<text>"` | Appended to the system prompt |
| `--thinking auto\|on\|off` / `--no-thinking` | Reasoning request control / hide reasoning output |
| `--trust-project` | Trust this project's config for this run only |

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Runtime error (the run failed, or `debug prompt --check` is over budget) |
| 2 | Usage or config error, including an unreachable local model server and `mcp serve --transport http` without `OCLITE_MCP_TOKEN` |
| 3 | Headless (`-p`) run that had any permission denial, hit `--max-turns`, or gave up on malformed text-protocol tool calls |
| 130 | Interrupted (Ctrl-C). In `-p`, the first Ctrl-C cancels cleanly; a second exits at once |

An unreachable **MCP** server does not exit 2: the run continues and reports `<name>: failed — …` (see Deviations below).

REPL commands:

| Command | |
|---|---|
| `/help` | List commands |
| `/agents [name]` | List agents, or switch the primary agent |
| `/model [provider/model]` | Show or set the model |
| `/profile [default\|local\|local-min]` | Show or set the profile |
| `/clear` | Start a new session |
| `/cost` | Token usage of this session |
| `/resume [id]` | List recent sessions, or resume one |
| `/mcp` | MCP servers, their status, and their prompts |
| `/mcp__<server>__<prompt> k=v …` | Send an MCP prompt |
| `/reconnect` | Reconnect MCP servers and re-probe the model server |
| `/compact` | Currently only prints a note: compaction runs automatically at the profile threshold |
| `/exit` (or `/quit`) | Quit |
| `@path` / `@<server>:<uri>` | Attach a file (≤ 256 KB) / an MCP resource |

Permission prompts in the REPL read `[y]es / [a]lways / [n]o`. `always` lasts for the session (it's saved in
the session, so `--resume` keeps it). Ctrl-C cancels the running turn; two in a row exit 130.

## Profiles

A profile decides the base prompt, the tool set, description lengths and when to compact. It's chosen like this:

1. `--profile`, or config `profile`, if set.
2. Otherwise a hosted provider (`anthropic`, `openai` without a `baseURL`) gets **default**.
3. Otherwise a loopback base URL gets **local**, which drops to **local-min** when the probe found no prefix cache
   (`prefix_cache: false`). A non-loopback openai-compatible server gets **default**.

`local-min` is never chosen automatically for a hosted provider.

| | default | local | local-min |
|---|---|---|---|
| Base prompt | opencode's per-model prompt | `local.txt` (≤ 600 chars) | `local-min.txt` (≤ 300 chars) |
| Tools | bash edit glob grep read skill task todowrite webfetch write | bash edit glob grep read write | bash edit grep read |
| Optional per agent (`tools:` frontmatter) | – | task todowrite skill webfetch | – |
| Tool descriptions | opencode's `.txt`, unchanged | rewritten, ≤ 300 chars | ≤ 150 chars |
| MCP tools | all schemas sent | deferred behind `tool_search` | deferred |
| Instruction file cap | none | 2000 chars per file | 1000 |
| MCP server instructions cap | 2000 chars | 600 | 300 |
| Old tool outputs stubbed after | 6 turns | 6 turns | 3 turns |
| Compaction trigger | 75% of context | 75% | 60% |
| Fixed-overhead budget | ≤ 7300 tok | ≤ 1200 tok | ≤ 600 tok |
| Measured, no MCP / with MCP | 7259 / 7625 tok | 951 / 1011 tok | 420 / 480 tok |

Measured with the `build` agent against the deterministic fake server ([docs/PERF.md](docs/PERF.md); live-server
numbers are pending). Check yours with `oclite debug prompt --tokens --check`. The opencode baseline is about 7,260
tok; `default` keeps opencode's texts, so its budget is that baseline, not the spec's 2,500. `default` with MCP
servers can exceed 7300, since it sends every MCP schema. Enabling `task` in `local` adds about 170 tok (1123).

## What you'll see and why

Local servers vary a lot, so on first use of a base URL + model oclite runs a small probe (at most 3 requests),
caches the result for 7 days in `~/.local/share/oclite/servers/`, and prints a one-line notice for each fallback
the first time it engages. `oclite debug server` shows every field and its source (`probe`, `config`, `default`,
`static`, `error-400`). To override any field, pin it in `servers["<base URL>"].capabilities` (see
[docs/CONFIG.md](docs/CONFIG.md#servers)); pinned fields are never probed.

| Notice | Meaning | Override |
|---|---|---|
| `tool calls: text protocol (server has no tool-call parser)` | The canary request got no `tool_calls` back, so tools are described in the prompt and the model replies with one fenced JSON block per turn. One tool per turn; a malformed call is fed back once, then the run ends (exit 3 headless). Permission checks still apply | Enable the server's tool parser, or pin `capabilities.tools_native: true` |
| `reasoning: reading vLLM delta.reasoning as reasoning_content` | The server streams reasoning as `delta.reasoning`; oclite renames it on the fly | `capabilities.reasoning_field` |
| `reasoning: splitting <think> tags out of the text` | No reasoning field, but `<think>` in the text: it's routed to the reasoning channel | `capabilities.think_tags` |
| `token counts: estimated (chars/4), marked est.` (or `/tokenize`) | No usage in the stream; numbers are estimates | `capabilities.usage_in_stream` |
| `prefix cache: none detected; auto profile is local-min` | See the probe caveat below | `capabilities.prefix_cache: true` |
| `request: <param> not accepted by the server, not sent` | `chat_template_kwargs`, `prompt_cache_key`, `reasoning_effort` or `parallel_tool_calls` got a 400; it's stripped from now on | `capabilities.accepts.<param>` |
| `context window: unknown, using 32768 (…)` | `/models` didn't report a context length | `servers[…].context_window` or `provider.<id>.models.<m>.limit.context` |
| `probe timed out after 30 s; …` | A slow server: conservative defaults were used | pin `capabilities`, or raise `servers[…].probe_timeout_ms` |
| `mcp <name>: failed — …` / `needs_auth — …; run: oclite mcp auth <name>` | An MCP server didn't connect; the run continues without it | fix the entry, `/reconnect` |
| `queued behind <label>` | Local servers get one request at a time (`concurrency: 1`), shared by sub-agents and side calls | `servers[…].concurrency` |
| `retrying: … (attempt n)` | Connection drop or 5xx: retried after 2 s, 4 s, 8 s | – |

**Probe caveats.** Two probed fields are heuristics, and both have a pin as the reliable path:
- `tools_native` depends on the model actually calling the canary tool. A model that ignores it is recorded as
  `tools_native: false`, and oclite falls back to the text protocol even if the server has a parser.
- `prefix_cache` compares the time-to-first-token of two identical ~2k-token prompts (the second must be ≥ 30%
  faster). When that can't be measured it defaults to `false`, which makes the automatic profile `local-min`. If
  your server does cache prefixes (vLLM with prefix caching, llama.cpp's slot cache), pin `prefix_cache: true`.

`oclite debug server --reprobe` (or `/reconnect` in the REPL) runs the probe again.

## MCP

### oclite as an MCP client

- **Config shape** is opencode's `mcp` block, so an existing `opencode.json` `mcp` section can be copied unchanged:
  `{"type": "local", "command": [...], "environment": {...}}` or `{"type": "remote", "url": ..., "headers": {...}, "oauth": ...}`.
  `oclite mcp add` writes these entries for you.
- **`--mcp-config`** also accepts Claude Code's `{"mcpServers": {"name": {"command", "args", "env"} | {"type": "http"|"sse", "url", "headers"}}}`,
  as a file path or inline JSON. `--strict-mcp-config` ignores servers from config files.
- **Remote transports**: StreamableHTTP first, then SSE. OAuth tokens live in opencode's
  `~/.local/share/opencode/mcp-auth.json`, so a server you authorized with `opencode mcp auth` works here too.
- **Tool names** are `mcp__<server>__<tool>` (Claude Code style), not opencode's `<server>_<tool>`. Characters
  outside `[A-Za-z0-9_-]` become `_`; names over 64 chars are shortened with a hash. For permissions this means
  opencode-style keys such as `"github_*": "deny"` don't match; write `"mcp__github__*": "deny"`. Claude Code globs
  like `--allowed-tools "mcp__github__*"` work unchanged.
- **Default permission** for MCP tools is `ask`. Under `read_only` (plan mode and the `plan`, `explore`, `audit`
  agents), tools whose server declares `annotations.readOnlyHint: true` are allowed without asking and all other
  MCP tools are denied. The hint is the server's own claim and can't be verified; see Security notes.
- **Deferred tools in local profiles**: to save tokens, `local` and `local-min` send only a `tool_search` tool
  (`{query, limit?}`). Matching tools become callable from the next turn, and a server's `instructions` arrive with
  the search result. The `default` profile sends every MCP schema up front.
- **Prompts and resources** (REPL): `/mcp__<server>__<prompt> key=value …` and `@<server>:<uri>`. Resource text over
  8 KB is saved to a file and attached by path.
- Timeouts: 30 s per request and connect by default (`timeout` in ms per server); progress notifications reset it.

### oclite as an MCP server

Claude Code, stdio (the client starts oclite):

```sh
claude mcp add oclite -- oclite mcp serve
# without the wrapper on PATH:
claude mcp add oclite -- bun /abs/path/to/opencode-dev/packages/oclite/src/index.ts mcp serve
```

HTTP on loopback with a bearer token (oclite refuses to start without `OCLITE_MCP_TOKEN`):

```sh
export OCLITE_MCP_TOKEN=$(openssl rand -hex 32)
oclite mcp serve --transport http --port 4096          # http://127.0.0.1:4096/mcp
claude mcp add --transport http oclite http://127.0.0.1:4096/mcp --header "Authorization: Bearer $OCLITE_MCP_TOKEN"
```

The server's permission mode is the one it was started with (`oclite mcp serve --permission-mode …`, default
`default`). A client's `permission_mode` on `agent_spawn` can only **tighten** it (plan < default < acceptEdits <
bypassPermissions), over stdio and HTTP alike.

| Tool | Input | Output |
|---|---|---|
| `agent_list` | – | `{agents: [{name, description, mode}]}` |
| `agent_spawn` | `{agent, prompt, background?, parent_id?, model?, cwd?, permission_mode?}` | `{id, state, envelope?}`; foreground waits and returns the `<task>` envelope |
| `agent_send` | `{id, message}` | `{ok, delivery: "steer"\|"not_running"}`; read at the next turn boundary |
| `agent_status` | `{id}` | `{id, agent, state, step, started_at, tokens, pending_permission?}` |
| `agent_result` | `{id, wait? = true, timeout_ms? = 300000}` | `{id, state, envelope?}`; `state: "running"` on timeout |
| `agent_cancel` | `{id}` | `{status: "cancelled"\|"already_finished"\|"not_found"}` |
| `agent_permission_reply` | `{id, request_id, action: "allow"\|"deny"\|"always"}` | `{ok, error?: "unknown_request"\|"expired"}` |

**Permission asks.** When the client supports MCP elicitation, oclite asks through it (`action: allow|deny|always`).
When it doesn't (opencode, for example), oclite sends a `notifications/message` with
`{"type": "permission_request", id, request_id, tool, patterns, summary, "reply_with": "agent_permission_reply"}`
and waits for `agent_permission_reply`. `agent_status` also shows the pending request. Either way, after
`permission_timeout_ms` (default 300000) the request is denied, so nothing blocks forever.

Progress arrives as `notifications/progress` (foreground calls with a progress token) and as
`notifications/message` carrying every render event. Each primary agent is also an MCP prompt, and sessions of this
server are readable as `oclite://sessions/<id>` resources. Full schemas: [docs/MCP.md](docs/MCP.md).

## Sub-agents

The `task` tool (opencode's contract: `description`, `prompt`, `subagent_type`, `task_id?`, `background?`) starts a
sub-agent with its own system prompt, tools and permissions. It sees only the brief, never the parent transcript,
and hands back only its final message in `<task id="…" state="completed|error"><task_result>…</task_result></task>`
(cut at about 4000 tokens). Background tasks report at the parent's next turn boundary. Limits: depth 2
(`subagent.max_depth`, and the parent agent's `max_depth`), 4 running children per parent (`subagent.max_concurrent`).
A child inherits its parent's deny rules; a read_only or plan-mode parent starts its children in plan mode.

Built-in roles (`packages/oclite/agents/*.md`, overridable by a project file with the same name):

| Agent | Mode | |
|---|---|---|
| `build` | primary | Default. Full tools; implements changes end to end |
| `plan` | primary, read_only | Investigates and returns a numbered plan; never edits |
| `explore` | subagent, read_only | Codebase search with file:line references, under 800 words; uses `small_model` when set |
| `code` | subagent | Implementer told to edit only the paths named in the brief (a prompt instruction, not a permission rule) |
| `audit` | subagent, read_only | Reviews a diff or commands for destructive ops and secret leaks; advises, never gates |

A sub-agent can also run out of process, as a child `oclite mcp serve` driven over MCP:

```markdown
---
description: Explorer in its own process
mode: subagent
read_only: true
transport: mcp
mcp:
  command: ["oclite", "mcp", "serve"]   # the default; "oclite" means this same CLI. Or: url: http://127.0.0.1:4096/mcp
---
```

The same envelope, limits and parent deny rules apply, and the child's permission asks come back to the parent.
With `url:`, the bearer token is the agent's `mcp.token`, else `OCLITE_MCP_TOKEN` for loopback URLs only. `task_id`
resume isn't supported for `transport: mcp`. In an untrusted project, `transport`/`mcp` are ignored.

## Hooks

Hooks run shell commands around tool calls, with Claude Code's contract. Both shapes work in `hooks.PreToolUse`,
`hooks.PostToolUse` and `hooks.Stop`:

```jsonc
{ "hooks": {
    "PreToolUse": [ { "matcher": "bash", "command": "./scripts/check.sh", "timeout": 10000 } ],          // oclite: ms
    "PostToolUse": [ { "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "bun fmt", "timeout": 30 } ] } ] // Claude: s
} }
```

- stdin gets `{hook, hook_event_name, session_id, tool_name, tool_input, tool_output?, cwd}` as JSON.
- Exit 0 continues. Exit 2 blocks: the tool doesn't run (PreToolUse), or stderr is added to the output
  (PostToolUse), or the turn continues with stderr as a reminder (Stop). Any other exit warns and continues.
- `matcher` is a case-insensitive, `|`-separated glob over oclite tool names (`bash`, `edit`, `mcp__github__*`).
- Default timeout 10 s; a hook that runs over is killed with its process group and only warns.

Full reference: [docs/HOOKS.md](docs/HOOKS.md).

## Security notes

- **Project trust.** A repo's `.oclite/config.json` and its agent files (`.oclite/agents`, `.opencode/agent(s)`,
  `.claude/agents`) are untrusted until you approve them. Until then oclite ignores their `provider`, `mcp`,
  `hooks`, `servers`, permission `allow` rules, `{file:}`/`{env:}` substitution and agent `transport`/`mcp`. The
  REPL asks once (`Trust <path>? [y/N]`); `-p` and `mcp serve` never prompt and skip those settings with a notice.
  `oclite trust [path] [--yes]` records trust in `~/.config/oclite/trusted.json` (real path + a hash of the config
  and agent files; any change makes it untrusted again), and `--trust-project` trusts for one run. Trusted project
  config runs code: hooks run shell commands, stdio MCP servers start processes, `{file:}` reads files. Only trust
  repos you'd run scripts from. Details: [docs/CONFIG.md](docs/CONFIG.md#project-trust).
- **Permission modes.** `default`: reads and searches are allowed, everything else asks. `acceptEdits`: edit and
  write are allowed too. `plan`: read_only rules for every agent. `bypassPermissions`: everything is allowed except
  `.env` access (still asks), `--disallowed-tools`, deny rules inherited from a parent, and read_only rules. Config and
  agent `permission` denies do **not** survive `bypassPermissions`. Headless `-p` rejects every ask and exits 3.
- **read_only** denies edit, write and bash, then allows `git status|diff|log`, `ls` and `pwd` (git `--output`,
  `-o` and `--ext-diff` are denied). Commands with shell metacharacters, wrappers (`bash -c`, `env`, `xargs`,
  `sudo`, …) or odd quoting are treated as `<complex>` and denied. MCP tools with `readOnlyHint: true` are allowed.
  A server that misreports the hint could run a mutating tool unprompted in read_only roles; to opt out, use
  `--disallowed-tools "mcp__<server>__*"`.
- **Bash deny rules are best-effort.** Chained or wrapped commands are checked segment by segment, but a regex
  deny list can't be airtight. A deny layered under a broad allow or `bypassPermissions` shouldn't be your only
  guard; the default `ask` and read_only are the real ones. `always` is never offered for complex commands.
- **.env guard.** Reading `.env` / `.env.*` asks in every mode, `bypassPermissions` included (`.env.example` and
  `.env.sample` are allowed). Other tools whose path or command names a `.env` file (bash, grep, edit, write, …) are
  checked as a read of it, so they ask too; headless rejects. Best-effort: a name built at run time isn't caught.
- **Outside the project.** Paths outside the working directory and project root ask (`external_directory`).
  Symlinks are resolved first, for this check and for the `.env` guard.
- **webfetch.** An `always` approval covers one origin. Loopback, link-local and private addresses are denied
  unless a rule allows that origin (`"webfetch": {"http://127.0.0.1:3000/*": "allow"}`); redirects (max 5) are re-checked.
- **Redaction.** API keys (from config or env, e.g. `ANTHROPIC_API_KEY`), provider and MCP header values, OAuth
  tokens, MCP `environment` values, secret-named command flags and URL credentials become `***` in terminal
  output, stream-json, MCP notifications, session JSONL and tool-output overflow files. Sessions and tool output are
  stored with 0700 directories and 0600 files.
- **`OCLITE_MCP_TOKEN`** isn't passed to bash, hooks, MCP stdio servers or `transport: mcp` children. A
  `transport: mcp` agent sends it only to a loopback `mcp.url`, unless the agent sets its own `mcp.token`.
- **MCP server.** HTTP binds `127.0.0.1` by default and needs `Authorization: Bearer $OCLITE_MCP_TOKEN` on every
  request (constant-time compare). A non-loopback `Origin` or an unexpected `Host` header gets 403, and bodies are
  capped at 4 MB. `--host` elsewhere prints a warning. `bypassPermissions` over HTTP needs
  `--i-understand-remote-bypass`. `agent_spawn` `cwd` must stay inside the project; resources list only this
  server's sessions. A client can tighten the permission mode but never loosen it.

## What's left out compared with opencode

| Area | In oclite |
|---|---|
| TUI | No: a readline REPL with streaming output |
| Desktop app, web UI, `serve` HTTP API | No |
| Session sharing (`share`) | No; sessions are local JSONL in `~/.local/share/oclite/sessions/` |
| LSP integration and diagnostics | No |
| Plugins | No; MCP servers and hooks cover extension |
| `apply_patch`, `question`, `websearch`, `list` tools | No (read/write/edit/glob/grep/bash cover the core) |
| Snapshots / undo, GitHub integration, enterprise features, IDE integration | No |
| Provider catalog (models.dev) and the AI-SDK provider set | Anthropic, OpenAI and any openai-compatible base URL |

## Deviations worth knowing

- An unreachable MCP server doesn't exit 2; the run continues with a status notice.
- Denials a `transport: mcp` child makes under its own rules, without asking the parent, don't count toward the
  parent's headless exit 3 (forwarded asks that are rejected do).
- MCP stdio grandchildren (e.g. a `docker run` without `--rm`) aren't killed; only the direct child is.
