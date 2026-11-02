# Claude Agent Provider

## Overview

The Claude Agent provider lets people use Claude models in opencode with their own Claude Code login. opencode runs the user's installed `claude` program through Anthropic's Claude Agent SDK.

The idea is that all of opencode UX stays the same, and claude code becomes another provider. We do not try to inherit settings a claude code user may have set because we want to allow them to experience default opencode UX, and we do our best to make the transition smooth.

## Name and Login

### Name

The provider is called "Claude Agent", with the ID `claude-agent`. The SDK's [branding guidelines](https://code.claude.com/docs/en/agent-sdk/overview#branding-guidelines) allow "Claude Agent" but do not allow "Claude Code" as a product name. T3 Code calls its version "Claude Code" anyway, maybe we can be allowed to do so too?

### Login

- opencode runs the user's own `claude`, found on `PATH` or set with `OPENCODE_CLAUDE_PATH`. It only uses the public SDK. It never sits between Claude Code and Anthropic or changes Claude Code's requests.
- opencode never reads Claude Code's saved login. Users sign in with `claude` in their terminal. `/connect` only records that they chose this login method.
- Any existing login works: a subscription, an API key or a cloud account.

## What Claude Sees

### System Prompt

- Chats use Claude Code's own system prompt, plus a short note saying it is running in opencode.

### Instructions

- On top of Claude Code's prompt, we add the selected agent's prompt as its role, and opencode's instructions: AGENTS.md files, skills, MCP instructions, project references and so on.
- opencode keys each instruction source. We pass every source except opencode's date and environment, because Claude Code writes its own.

### Tools

- Claude Code's built-in tools are off. Claude gets opencode's tools instead.
- When Claude calls a tool, the plugin holds the call. opencode runs it like any other model's tool call, including permission prompts, then sends the result back to Claude.
- Why: the history looks the same whichever model wrote it, so switching between Claude and other models works. There is also only one permission system.
- If opencode's tools cannot be given to Claude, the request fails. It never falls back to Claude Code's tools.
- If Claude calls a tool that was not offered, such as `glob` without the `mcp__opencode__` prefix, Claude Code answers with its own `No such tool available` error and Claude carries on. The plugin ignores the call, so it never reaches opencode and does not end the step.
- When the list of tools changes, the Claude process restarts, because the SDK cannot swap tools while running.
- Claude Code's plan mode is not used. opencode's Plan agent works as it does for other models, through its permissions and reminder messages.

## Claude Code Settings

Claude Code reads none of the user's Claude settings. The plugin passes every setting directly when it starts Claude.

### Turned Off

- Settings files in `~/.claude` and the project's `.claude` folder, CLAUDE.md files, hooks, MCP servers and skills. opencode has its own versions of these.
- Built-in tools. Claude uses opencode's tools instead.
- Auto compaction. opencode compacts instead.
- Auto memory. Claude saves notes about the user and project to its own files and reads them in later sessions. Only Claude models would see them, and opencode could not show or control them.
- Away summaries. Claude Code writes a recap when you come back to an idle terminal session. Opencode does not do this.
- Tool search. Claude Code hides MCP tools until Claude searches for them. All of opencode's tools reach Claude as MCP tools, so this would hide every one of them. Opencode also has native tool deferral through codemode for normal MCPs.
- The advisor tool. Claude can ask a stronger model for advice in the middle of a task, using the user's plan. opencode could not show or control these calls.
- The non-streaming fallback. When a stream fails partway, Claude Code retries without streaming, and opencode would hang waiting for the step to end.
- The refusal fallback. When a safety classifier flags a request, Claude Code switches the session to another model, so the model running would no longer match the one picked in opencode.

We also clear three variables a user might have set in their shell. `CLAUDE_CODE_SIMPLE` would skip the subscription login. `CLAUDE_CODE_EFFORT_LEVEL` would override the effort chosen in opencode. `MCP_TOOL_TIMEOUT` would cap every opencode tool call, failing subagents and permission prompts that run longer.

### Set by opencode

- The path to `claude` (`OPENCODE_CLAUDE_PATH`, or `claude` on `PATH`), and the session's folder
- The model and effort chosen in opencode.
- The system prompt described above
- opencode's tools, as the only tools Claude may use. Anything else is refused without asking.
- Two hooks that Claude Code runs around each tool call:
  - Before the call: gives us Claude's ID for the call. Our tool handler can't see this ID, and opencode needs it to send back the right result. Because we only remember one ID at a time, tools must run one at a time, so we never mark them as safe to run in parallel.
  - After the call: adds PDFs and linked images from opencode's result, which a normal MCP tool result can't carry.
- Thinking with summaries, so opencode has reasoning text to show
- Messages sent exactly as given. opencode already expands `/commands` and adds `@file` contents before sending, so Claude Code does not process them again. It also skips the context Claude Code normally adds at the start of each turn, such as nested CLAUDE.md files, skill lists and reminders. This needs Claude Code 2.1.248 or later.
- A higher limit on tool output, so opencode's own truncation applies instead
- Saved Claude sessions for chats, but not for side calls such as titles

### User Config

Users can configure the `claude-agent` provider and its models in opencode config. We map opencode's keys to the matching Claude Code setting:

| opencode                 | Claude Code                     |
| ------------------------ | ------------------------------- |
| `settings.baseURL`       | `ANTHROPIC_BASE_URL`            |
| `settings.apiKey`        | `ANTHROPIC_API_KEY`             |
| `settings.authToken`     | `ANTHROPIC_AUTH_TOKEN`          |
| `settings.headerTimeout` | `API_TIMEOUT_MS`                |
| `settings.chunkTimeout`  | `CLAUDE_STREAM_IDLE_TIMEOUT_MS` |
| `headers`                | `ANTHROPIC_CUSTOM_HEADERS`      |
| `body`                   | `CLAUDE_CODE_EXTRA_BODY`        |
| effort                   | the SDK's `effort` option       |
| max output tokens        | `CLAUDE_CODE_MAX_OUTPUT_TOKENS` |

- A model's config overrides the provider's.
- Settings are applied in this order, with later ones winning: the user's shell, then opencode config, then the settings we turn off.
- Changing any of these restarts the Claude process.
- Without an explicit max output, we drop opencode's automatic limit and let Claude pick its own.

## History and Switching Models

- opencode's history is the source of truth. Claude's replies are saved in opencode's database like any other model's, so switching from Claude to another model just works.
- Claude cannot load history it did not write. When a user switches to Claude, everything Claude has not seen is sent as one user message, wrapped in `<conversation-checkpoint>`, without thinking text.
- When a user switches back to Claude later, only the part it missed is sent.
- After an edit or undo, the plugin copies Claude's session up to the last point where both histories match and continues from there. If nothing matches, Claude starts fresh with the whole history.
- After an interrupted reply, Claude keeps the partial reply it already wrote. The next message continues the same Claude session, even when opencode saved a different partial reply or none at all.
- Plugins that change the message history through the `context` hook work too. Claude gets the changed history the same way as after an edit or undo.

## Running Claude

### Processes

- Each session has one long-running `claude` process. It stops after 5 minutes idle, and the next message picks up the saved Claude session.
- While opencode runs Claude's tool calls, the process is not idle, however long the tools take. Subagents, permission prompts and questions can easily take more than 5 minutes, and stopping the process then would record the call as cancelled by the user. If opencode stops running the session before sending the results, for example because the user interrupted a tool, the 5 minutes start then.
- Why: the SDK starts one process per conversation and cannot share a process between sessions. Claude Code in a terminal works the same way.
- The process restarts when the system prompt, tools, connection settings or output limit change.

### Errors and Usage

- Claude Code retries failed requests itself, so opencode does not retry for this provider. Errors such as reaching a plan limit show once.
- Cost depends on the login Claude reports. A subscription shows $0 because it covers usage. An API key or a cloud account shows the models.dev price of the model Claude resolves, such as `claude-opus-5-5` for `opus`:
  - API key, Claude Platform on AWS or Google Cloud, and Bedrock's Mantle endpoint: Anthropic's prices.
  - Bedrock: Bedrock's prices, which are 10% higher for regional models like `us.anthropic.claude-opus-5-5`.
  - Vertex and Foundry: Google Vertex's and Azure's prices.
- A custom base URL, set in opencode or in the shell, shows $0, since a gateway or proxy bills in its own way. So does Claude's enterprise gateway login.
- Why not Claude's own cost: it is a running total for the turn, so it cannot be split per response.
- Claude Code reports usage for one model response several times while it streams, and again as a total for the turn. Adding these up would count the same response several times and make opencode compact too early. We keep the highest count for each response, and use the last response's input as the context size.
- Each model's context size comes from Claude. Without it, opencode's 200k default applies.
- The model list is refreshed whenever Claude reports it: on `/connect`, when the login changes, and each time a new Claude process starts. It is saved, with where the login's prices come from, so opencode can show models and costs at startup without running `claude`.

### Titles, Summaries and Compaction

- Titles use opencode's title prompt instead of Claude Code's, because a title is a standalone task.
- Summaries and compaction run on a throwaway copy of the chat. They keep the chat's tools and prompt so Claude can reuse its prompt cache. In one test, newly cached tokens fell from 8,577 to 32.
- opencode's compaction and subagents are used, not Claude Code's.

## Shipping

- The provider is built into core, not shipped as a separate package. A separate package meant extra publishing work and a circular test dependency.
- The SDK is an optional dependency. It only loads when first used, so it does not slow down startup.
- Installing the SDK also downloads its own copy of `claude` (about 270 MB unpacked). We never run it. It is cached locally and on Linux and macOS CI, but Windows CI downloads it on every run. The opencode binary only includes the SDK's code.
- The provider is skipped where opencode cannot start local programs, such as hosted opencode and remote workspaces. A stub lets hosted builds work without the SDK.
- It is registered before opencode's fallback for unknown providers (issue #42788).
- There are no plugin options. `OPENCODE_CLAUDE_PATH` picks which `claude` to run.

## Testing

- Tests run a fake `claude` program that replays recorded real sessions. The SDK itself is not mocked, so tests exercise the real SDK.

## Limitations

opencode features that do not work, or work differently, with Claude Agent models.

- `claude` must be installed and signed in on the same machine. It does not work in hosted opencode or remote workspaces.
- Chats follow Claude Code's base prompt, not opencode's built-in agent prompts. Custom agent prompts still apply.
- Temperature, top-p, top-k, penalties, seed and stop sequences are not supported.
- Base URLs and headers come only from config. Plugins cannot change them per request (for now), and the `http.request` and `http.response` hooks never run, because Claude Code makes the API calls.
- Calls to tools that were not offered are not shown or saved in opencode (see [Tools](#tools)). When such a call is the only one in a response, that response's tokens are not counted in cost.

## Claude Code Features Not Supported

Claude Code features that opencode has no version of.

- Claude plan usage: `/usage`, the options shown at a limit, auto-continue when a limit resets, and buying extra usage. opencode's `/usage` shows OpenCode Console usage instead.
- Cloud features: cloud sessions and `/teleport`, scheduled tasks and `/autofix-pr`.
- Agent teams and messaging between sessions.
- `/loop`.
- Auto mode, where a classifier approves permissions, and ultracode.
- Auto memory and away summaries aka recaps (see [Turned Off](#turned-off)).
- Computer use, sandboxed Bash and notebook editing.
- Bundled skills such as `/simplify`, `/verify` and `/insights`.

## Open Questions and Concerns

- Can we call this "claude code" instead of "claude agent"? It's not allowed per the anthropic docs, but everyone else does it.
- Can we reuse cc credentials for usage endpoints? Also not allowed but everyone else does it.
- I think the biggest issues for claude code users will be the features not supported above. Maybe some features like auto mode and memory should be able to be enabled behind env vars? What is the best UX here?
- Similar to above, is providing UX most similar to default opencode the way to go? Or maybe we should make it more similar to the claude code they're coming from?
- The CC dependency is big (our second biggest) and will need to be downloaded for CI, yikes
- There are some reports online that claude -p and claude sdk users get less usage out of their claude subs than normal claude code. This is not documented or verified.
- Do we need to discuss anything here with anthropic or any kind of approval?
