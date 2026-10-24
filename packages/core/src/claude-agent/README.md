# Claude Agent provider

Lets users run their own Claude Pro or Max subscription inside opencode. Claude keeps Claude Code's own base instructions, while opencode owns the conversation, permissions and tool execution. Only documented Claude Agent SDK features are used.

The plugin is `plugin/provider/claude-agent.ts`. Everything else lives in this folder.

## Setup

1. Install Claude Code and sign in: `claude auth login`.
2. In opencode, run `/connect` and pick **Claude Agent** → "Claude Code login (claude auth login)".
3. Pick a Claude Agent model.

opencode uses `claude` from `PATH`. Set `OPENCODE_CLAUDE_PATH` to use another binary. The `@anthropic-ai/claude-agent-sdk` package must be installed; it is an optional peer dependency of core.

## Ground rules

- **Documented SDK features only.** Public SDK options, hooks, messages and documented environment variables. We never proxy or rewrite Claude Code's API requests.
- **We never touch credentials.** The user installs `claude` and signs in themselves. opencode never reads, stores or forwards tokens, and never reads `~/.claude` credential files.
- **Use the user's installed `claude`** through `pathToClaudeCodeExecutable`, never the copy bundled with the SDK.
- **Accept every login Claude Code supports**: subscription, API key, Bedrock or Vertex. Under the SDK, Claude Code uses an `ANTHROPIC_API_KEY` from the environment without asking; that's documented behavior, so we don't warn about or override it.
- **Local only.** The SDK needs child processes, a real filesystem and the `claude` binary. The plugin skips itself in workspaces and where opencode can't start processes (workerd, Durable Objects).

## Policy

- Anthropic's [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) lets an end user sign in to the **unmodified** Claude Code binary with their own subscription, "including where a platform hosts Claude Code". It forbids third parties from offering Claude.ai login, routing requests through Pro or Max credentials, or collecting or intermediating credentials. We run the user's own `claude`, leave its login alone, and use the SDK as published.
- Naming: the SDK branding guidelines prefer "Claude Agent" for dropdowns and don't permit "Claude Code" in product names. So the provider is "Claude Agent" with ID `claude-agent`, and "Claude Code" only describes the `claude` binary.
- [Agent SDK use with a Claude plan](https://support.claude.com/en/articles/15036540) draws from the user's plan limits. Third-party measurements show the SDK uses limits about 1.7× faster than interactive Claude Code.

## Background: the Claude Agent SDK

`@anthropic-ai/claude-agent-sdk` (tested with 0.3.301 and Claude Code 2.1.302) doesn't call Anthropic's API itself. It starts `claude` as a child process and talks JSON over stdin/stdout. `claude` runs the agent loop, saves the conversation as JSONL under `~/.claude/projects`, and signs in however the user set up.

Claude Code owns its sessions. There is no documented way to load a history Claude didn't write: we can only add user messages, and resume, rewind or branch sessions Claude wrote itself.

Options we use:

| Option | What it does |
|---|---|
| `query()` with streaming input | One long-lived session per opencode session. |
| `systemPrompt` | The `claude_code` preset with selected opencode context appended. Standalone titles use opencode's title instructions. |
| `tools: []` | Turns off all built-in tools. |
| `mcpServers` with our own server instance | Offers opencode's tools, seen by Claude as `mcp__opencode__<tool>`. |
| `hooks` (`PreToolUse`, `PostToolUse`) | Match tool calls to IDs, and hand PDFs to Claude. |
| `permissionMode: "dontAsk"`, `allowedTools` | Our tools run without Claude asking; opencode asks instead. |
| `resume`, `forkSession` | Continue a saved session, or branch it at a message. |
| `persistSession: false` | Side calls and the login check save nothing. |
| `includePartialMessages`, `thinking` | Stream text and readable thinking summaries. |
| `setModel`, `applyFlagSettings`, `interrupt` | Live model, effort and cancel controls. |
| `initializationResult()`, `getContextUsage()` | Version, account, models and context sizes, without a model call. |
| `verbatimPrompts` | Turns off slash commands, `@file` expansion and turn-start notes. Needs Claude Code 2.1.248+. |
| `settingSources`, `strictMcpConfig`, `skills` | Stop Claude Code loading anything from `~/.claude` or the project. |
| `env` | The child's environment. It replaces the parent's rather than merging. |

## Design

Claude thinks and opencode acts. Claude Code's tools are off and opencode's are offered instead, so opencode runs every tool and keeps the authoritative history. A Claude Agent session works like any other opencode model.

### How it plugs into opencode

1. **Provider and models** (`plugin/provider.ts`). Models come from the last saved list, or none before the first check. opencode never runs `claude` at startup: the login check runs when the user connects, and each chat's startup reports the current login and models. Either updates the list. The exception: a connection with no saved list checks once in the background at startup.
2. **`/connect`** (`plugin/integration.ts`). An `external` login method, like Google Vertex's gcloud login. opencode stores only which method was chosen, never a token. Installing and signing in stay in the official CLI.
3. **Our model** (`plugin/aisdk.ts`). The `aisdk` `sdk` hook for package `@opencode/claude-agent` returns a `LanguageModelV3` whose `doStream` drives the SDK instead of making an HTTP call. The plugin runs before `DynamicProviderPlugin`, which would otherwise try to install that package from npm.
4. **Call kind** (`plugin/session.ts`). opencode sends `x-opencode-session-id` with every call. Our `model.request` hook adds the kind (primary, compaction, title or generate) and, for a native fork, the source session.
5. **State** in plugin storage: which Claude session belongs to each opencode session, and what Claude has already seen.

### One step

1. opencode calls `doStream`.
2. The plugin compares the request with what Claude has seen (see "Keeping Claude in sync") and sends only the new part, usually the new user message.
3. Text and thinking stream back.
4. When Claude calls a tool, our MCP handler doesn't run anything. It parks a promise, and the step ends with the tool calls and finish reason "tool calls".
5. opencode runs the tools with its usual permissions.
6. On the next step, the plugin finds the results in the request, resolves the parked handlers, and Claude continues.
7. When Claude finishes without a tool call, the step ends with "stop".

Each opencode step is roughly one Claude model call, matching opencode's one-step-one-call rule.

- **Matching calls to IDs.** `PreToolUse` fires with the `tool_use_id` just before Claude Code calls our handler.
- **Several tool calls.** Claude Code calls handlers one at a time, in order. We emit all calls in one step and return results as asked. Our tools are never marked read-only, because Claude Code runs those in parallel and matching would break.
- **Tool errors** go back with `isError: true`. Plain text errors make Claude retry calls that can't succeed.
- **Failing closed.** If our MCP server doesn't connect, the step fails. Claude's built-in tools never turn back on.

### Other details

- **System prompt.** `{ type: "preset", preset: "claude_code", append, snapshot: false }`. The append holds a short opencode runtime note, the custom agent role, tool-routing guidance, and the MCP instructions, skill list, Code Mode catalog and instruction files from opencode's system prompt. opencode's built-in agent prompt is not forwarded. `snapshot: false` is required, or the SDK keeps the first prompt across resumes. A changed append restarts the process with `resume`.
- **Process lifetime.** One `claude` per active session, stopped when idle and resumed when needed. Processes live in one registry for the whole opencode process, so a plugin reload doesn't kill them: the old setup hands them over for about 10 seconds. After compaction the old process is never reused.
- **Stopping.** Always `interrupt()`, then drain until the session file is written, then close. Any other order can start another model call or leave the transcript on the wrong branch.
- **Login check** (`claude/probe.ts`). Starts a session that never sends a message, reads `initializationResult()` and each model's context size, then closes. No tokens used, no session file. A logged-out `claude` reports `tokenSource: "none"` without an API key; anything else counts as signed in. Checks run one at a time and look up `claude` each time, so installing or signing in recovers without a reload.
- **Version check.** At least 2.1.248 (`verbatimPrompts`). Older or unreported versions get a message to run `claude update`.
- **Usage.** Claude Code can report the same API call several times while streaming, so we keep the largest count per API message ID. Models have an empty cost list; the subscription covers it.
- **Empty success.** After server errors, Claude Code can report success with no output. `api_error_status` on the result turns it into an error.
- **Retries.** Claude Code retries API errors itself. Our `retry` hook stops opencode retrying them again.
- **Windows** uses `claude.exe`, not the `.cmd` wrapper. Not yet run on Windows.

## Keeping Claude in sync with opencode

Claude Code keeps its own copy of the conversation. **opencode's copy always wins**, and the plugin keeps Claude's matching it.

**Claude → another model:** nothing to do. opencode recorded everything in its own format.

**Another model → Claude:** missed turns go at the start of the next user message as a catch-up message: user messages and attachments, other models' replies, tool calls and results as opencode stored them, and no thinking. Images and PDFs become real blocks in the same message.

### The record

Per opencode session, plugin storage keeps the Claude session ID and fingerprints of the message groups Claude has seen, with Claude transcript UUIDs at safe boundaries. The ID is saved once a transcript exists; history only after a step completes. A record without history is rebuilt.

A fingerprint covers what the model sees: role, text, attachments, tool calls and results. It skips thinking and provider metadata, which opencode sends differently per model. Back-to-back user messages are compared as a group, ignoring order, since opencode can insert notes (such as Plan mode reminders) before the latest one. Tool-result images that opencode moves into a following user message count as part of the result.

The comparison uses the request after every plugin's `context` hook, so Claude's copy matches what any other model would get.

### The four cases

Before every main call (`sync/decide.ts`):

1. **In sync.** Send only the new user message, or the tool results Claude is waiting on.
2. **Other models added turns.** Resume and send a catch-up of only the new turns. Claude keeps its own memory and warm cache.
3. **Earlier history changed or got shorter** (undo, edit, fork, compaction, a history-editing plugin). Branch with `forkSession(sessionId, { upToMessageId })` at the last safe match, then continue as case 1 or 2. The SDK remaps UUIDs on fork, so `claude/fork.ts` reads the transcript before and after to verify the copy and map old UUIDs to new. The old session is never changed.
4. **Nothing matches.** New Claude session with a catch-up of the whole history.

A fork boundary needs a saved UUID and no unanswered tool calls. The final user group is current input, even when undo resubmits the same text, so it stays outside the fork. A missing local transcript (checked with `getSessionInfo`) falls to case 4. Prompts are converted before opening a process, so a rejected attachment can't pair a fresh process with an old record.

| opencode event | What happens |
|---|---|
| Undo or edit | Branch at the last match (case 3). |
| Fork | Load the source session's record, branch its safe prefix, catch up the rest. |
| Compaction | Case 4 with the summary. A parked tool call is cancelled and its process stopped. |
| Custom agent role change | New append, restart with `resume`. |
| Tool list change | Restart with `resume`. The SDK's `setMcpServers` treats a same-named in-process server as unchanged. |
| Claude model or effort change | `setModel` / `applyFlagSettings` on the running session. |
| Server restart | `resume`. Results Claude was waiting on arrive as a catch-up. |
| Session moved to another machine | Transcript is missing, so case 4. |

## Fitting opencode features

Most features become ordinary messages and tools before any model sees them.

- **opencode commands** expand to text before the model call. **Claude Code's commands** are off (`verbatimPrompts`), so "/etc/hosts is broken" stays text.
- **Attachments.** Text files are already text. Images and PDFs become `image` and `document` blocks. Tool-result images go back into the result. Tool-result PDFs return a placeholder that `PostToolUse` replaces with a `document` block through `updatedMCPToolOutput`; nothing is written to disk.
- **Tool definitions.** The SDK's `tool()` helper only takes zod, so `tools/server.ts` builds an MCP server with the low-level `Server` class from opencode's JSON Schemas.
- **Large tool output.** We raise Claude Code's limits (`_meta["anthropic/maxResultSizeChars"]`) and rely on opencode's truncation.
- **Tool names.** `read` ↔ `mcp__opencode__read`. Claude Code hides names over 128 characters, so names over 64 are shortened with a hash.
- **Tool descriptions** are cut at 2048 characters, so the subagent tool's agent list moves to the front.
- **Tool errors.** opencode lowers error results to plain text outputs. Our `context` hook keeps the error and aborted status in provider metadata first.
- **Steering** a turn with running tools sends input with SDK priority `next` before releasing the results. After opencode stops a turn (results typed `aborted`), the next request interrupts and drains the old turn, then starts a normal turn.
- **Effort** is a model variant from the login check's list. The child clears inherited `CLAUDE_CODE_EFFORT_LEVEL`.
- **Max output tokens.** Primary calls drop opencode's automatic budget so Claude Code picks its own. Explicit overrides and compaction's budget pass through `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, and a change restarts with `resume`. The catalog reports output as unknown (`0`).
- **Max steps.** `toolChoice: "none"` can't be expressed, so the plugin drops our tools and restarts with `resume`.
- **Context size** comes from `getContextUsage({ detail: "summary" }).rawMaxTokens` per model, cached with the list. Without it, opencode's 200k fallback applies. Claude's own compaction stays off.
- **Title model.** Haiku models get the `claude-haiku` family, so opencode picks them for titles.
- **Plan limits.** Reported only when a call actually fails, with the reset time in UTC.

### Claude Code features turned off

`claude/query-options.ts`. opencode's version wins:

| Feature | Turned off with |
|---|---|
| CLAUDE.md, auto memory | `settingSources: []`, env `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` |
| Skills | `skills: []` |
| Hooks, MCP servers, plugins from `~/.claude` | `settingSources: []`, `strictMcpConfig: true`, `disableAllHooks: true` |
| Permissions | `permissionMode: "dontAsk"`, `allowedTools: ["mcp__opencode__*"]` |
| Compaction and idle compaction | env `DISABLE_AUTO_COMPACT=1` |
| Away summary | env `CLAUDE_CODE_ENABLE_AWAY_SUMMARY=0` |
| Web search, todos, plan mode, questions, subagents | `tools: []` |
| Tool search | env `ENABLE_TOOL_SEARCH=false` |
| Advisor tool | env `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` |

`--bare` / `CLAUDE_CODE_SIMPLE` must stay off: it skips OAuth.

### Side calls

- **Titles** and `ctx.generate.text`: a one-shot `query()` with no tools and `persistSession: false`, using the task's instructions as the system prompt.
- **Compaction and generate** each snapshot the matching safe prefix into a throwaway fork, keep the chat's tools and system prompt (so the prompt cache matches), and delete the fork afterwards, including on failure or cancel. Compaction stops the primary process first; generate only locks it while copying.
- **Subagents** inherit the model, so each gets its own `claude` process.

## Plugin hooks

Most hooks work unchanged. Hooks on the HTTP request to the provider don't, because Claude Code sends it.

| Hook | Works? |
|---|---|
| `prompt`, `compaction`, `generate`, `title` session hooks | Yes |
| `context` | Partly: history changes reach Claude; the assembled system prompt isn't forwarded wholesale |
| `model.request` | Partly: headers reach us, never Anthropic; `baseURL` is ignored |
| `http.request`, `http.response`, WebSocket hooks | No, they never fire |
| `retry` | Partly: only sees errors after Claude Code gives up |
| `tool.*`, `permission.*`, `shell.*` | Yes |
| `agent.transform` | Partly: models, permissions and step limits work; built-in prompts are replaced by the preset; temperature and similar settings are ignored |

A `context` hook that changes earlier messages makes the plugin branch Claude before the change and catch up the rest. Occasional edits are fine; editing history on every step turns every step into a restart.

## Limitations

- No workerd, Durable Objects or workspaces.
- No custom base URLs or request headers, and no temperature, top-p, top-k, penalties, seed or stop sequences.
- Turns from other models arrive as a catch-up, not as Claude's own memory.
- Chat follows Claude Code's base instructions, not opencode's built-in agent prompts.
- Every side call and parallel subagent is a `claude` process, and uses plan limits.
- Models cost $0 in opencode; plan usage only shows through limit errors.
- Recovery after a crash mid-turn is limited. Resuming between turns works.

## Code structure

```
plugin/provider/claude-agent.ts   The plugin: make(io, registry), skips without local processes, runs each register
claude-agent/
├── plugin/             The only code that sees the plugin context
│   ├── provider.ts     The provider and its saved model list
│   ├── integration.ts  The login method and connection status
│   ├── aisdk.ts        Hands opencode our model
│   ├── instructions.ts Agent roles for conversation requests
│   └── session.ts      Request kinds, output budget, tool error status, no retries
├── claude/             The only code that starts or talks to Claude Code
│   ├── sdk.ts          Loads the SDK on first use, through #claude-agent-sdk
│   ├── agent-sdk.ts    #claude-agent-sdk: the real SDK
│   ├── agent-sdk.workerd.ts  #claude-agent-sdk on workerd: throws
│   ├── io.ts           Starting claude, checking, forking and deleting sessions; tests swap it
│   ├── fork.ts         Transcript copying and UUID remapping
│   ├── query-options.ts  Shared settings: binary, everything turned off, permissions
│   ├── status.ts       The latest login check result
│   ├── session.ts      One process: input queue, reader, interrupt, drain, close
│   ├── sessions.ts     Registry: resume/restart, idle shutdown, reload handover, side calls
│   └── probe.ts        Login, version, models and context sizes
├── language-model/     The AI SDK model, laid out like github-copilot/
├── tools/              MCP server, parked calls, hooks, names, results
└── sync/               Record, fingerprints, checkpoints, the four cases, catch-up
```

Rules:

1. Only `plugin/` sees the plugin context. Other modules get what they need passed in.
2. Only `claude/sdk.ts` loads the SDK at runtime, on first use; everything else uses its types. `tools/server.ts` is the only runtime user of `@modelcontextprotocol/server`.
3. `sync/` (except `record.ts`), the converters, `tools/names.ts` and `tools/result.ts` are plain functions, tested without services or processes.
4. One job per file.

| Change | Where |
|---|---|
| A new hook | A file in `plugin/` exporting `register`, called from the plugin |
| Another Claude Code feature to turn off | `claude/query-options.ts` |
| A new attachment type | `language-model/convert-to-claude-message.ts` |
| A new kind of history change | `sync/decide.ts`, plus a test |
| A new side-call kind | `language-model/request-kind.ts`, plus a branch in the model |
| An SDK or Claude Code upgrade | Re-record (below), then start in `claude/` |

## Testing

Most tests run the real SDK against a fake `claude`, so they are fast, offline and use no plan limits.

| Level | Where | Real | Faked |
|---|---|---|---|
| Pure logic | `test/claude-agent/{sync,tools,language-model}` | Our plain functions | Nothing |
| Fake Claude Code | `test/claude-agent/{claude,language-model,tools}` | The SDK and our model code | The `claude` program |
| Plugin | `test/plugin/provider-claude-agent.test.ts` | The plugin in opencode's plugin host | The `claude` program |

**Why fake `claude`, not `query()`.** The fragile parts happen inside the SDK as it reacts to `claude`: parked tool calls, `PreToolUse` matching, interrupts and `PostToolUse` PDFs. Faking `query()` would test our copy of that behavior. The SDK's documented `spawnClaudeCodeProcess` option lets `test/claude-agent/lib/fake-claude.ts` stand in for `claude` inside the test process:

```ts
const claude = FakeClaude.make([
  FakeClaude.expectStartup(),
  FakeClaude.expectTurn({ recording: "text", index: 0 }),
  FakeClaude.expectInterrupt(),
])
```

- Each step checks the kind of SDK input and replays recorded replies up to the next input.
- The fake keeps everything the SDK sent (flags, environment, start-up request, user messages), so tests check both directions.
- A test fails on an unfinished step or unexpected input. Tests wait on steps (`claude.started`, `claude.reached`), never on time.
- `forkSession` and `deleteSession` work on session files directly, so `ClaudeIO` exposes them separately and `test/claude-agent/lib/fake-io.ts` fakes them in memory.

The wire format between the SDK and `claude` is internal and undocumented; recordings are how we notice it changing.

### Recordings

`test/claude-agent/fixtures/recordings/` holds real `claude` traffic in both directions, one complete process per file. The first line holds the Claude Code version, SDK version, model and date. `test/claude-agent/lib/recorder.ts` replaces account email, organization, user name and home paths, and never saves thinking, signatures or redacted thinking.

On a Claude Code or SDK upgrade: update the pinned SDK, re-record, review `git diff` on the recordings, then fix the fake or our code.

### Rules

opencode's unit test rules apply. No sleeps: races use `Deferred` and the fake's steps; registry timers use `TestClock`. No `mock.module`; fakes come in through `ClaudeIO`. Each test gets its own temporary folders. Only recording runs start a real `claude`.

## References

- [Claude Code environment variables](https://code.claude.com/docs/en/env-vars)
- [T3 Code](https://github.com/pingdotgg/t3code): `ClaudeAdapterV2.ts` (process handling, login probe, attachments) and its fake `claude` in `ClaudeAdapterV2.test.ts`
- [OpenChamber's opencode-claude](https://github.com/openchamber/opencode-claude): process shutdown order, reload survival, usage counting, rate-limit events and tool descriptions
