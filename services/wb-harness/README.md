# wb-harness

OpenAI-compatible bridge to the Wildberries AI assistant (`ai-proxy.wildberries.ru`), so OpenCode and other
clients can use it as a model with tool calling and coding.

> Educational reverse-engineering. It uses your own account token, violates the Wildberries terms of service,
> and can break at any time. Do not use it in production or with other people's accounts.

## What it does

- `POST /v1/chat/completions` — OpenAI-compatible chat, streaming and non-streaming.
- `POST /api/chat/v5/message` — transparent Wildberries-native proxy with tool enrichment.
- Tool calling: the harness plans calls (OpenAI `tool_calls`) and the client executes them, then sends results
  back as `role: "tool"` messages.
- Coding: code generation and explanation are answered by the Wildberries model directly.
- Shopping enrichment: product links, catalog search, product details, unit-price comparison run before the
  model call and are injected into the prompt as plain facts.

## Discovered upstream protocol

Request: `POST https://ai-proxy.wildberries.ru/ai-proxy/api/chat/v5/message`

Required headers:

| Header | Value |
| --- | --- |
| `authorization` | `Bearer <token>` from `id.wb.ru` |
| `x-userdata` | opaque blob from the site request |
| `content-type` | `application/json` |
| `accept` | `text/event-stream` |
| `origin` | `https://www.wildberries.ru` |
| `x-client` | `web` |

Body:

```json
{ "idempotency_key": "<uuid>", "text": "<prompt>", "session_id": "<uuid, optional>" }
```

`schema` errors reveal fields: `idempotency_key` is required, `text` or `attachments.images` must be non-empty.
`session_id` continues an existing dialog.

Response: SSE frames (`id:`, `event: start|chunk|done`, `data: <json>`) where the JSON is `{ type, data }`:

| `type` | Meaning |
| --- | --- |
| `system_info` | session id, message id, timestamps |
| `text` | incremental text; `data.block_position` is `start`/`end`/`single` |
| `updated_text` | full replacement of the accumulated text |
| `suggests` | follow-up suggestions |
| `scenario_info` | `scenario` and `state_manager.state` (`success`, `ignored`, `moderation_blocked`) |

Rate limiting: `429` with `retry-after` (seconds) and `{"error":"rate_limit_exceeded","retryAfterSeconds":N}`.

## Limits found while building this

- The assistant is a shopping bot. It answers general and coding questions, but refuses or moderates content
  framed as a system prompt, a tool/function protocol, or an off-topic agent task (shell, git, file access).
- It cannot emit native tool calls. The harness therefore plans tool calls on its own and lets the client
  execute them.
- When a tool result is off-topic for the shopping bot (for example `git status`), the assistant refuses the
  final answer. The harness then returns the raw tool output instead of the refusal, flagged as
  `wb_harness.fallback = true`, so the agent loop can continue.

Because of that, tool choice is heuristic (intent + path/command parsing), not model-driven. It works well for
explicit requests ("прочитай файл src/index.ts", "запусти git status", "найди все файлы *.ts"), and falls back
to the model for everything else.

## Quick start

```sh
cd services/wb-harness
bun install
./start.sh
```

`start.sh` does everything: picks a free port, reuses valid credentials or extracts them from the browser
(restarting it once if needed), starts the server, and verifies a real completion before printing the
endpoints. `Ctrl-C` stops it.

```sh
PORT=3005 ./start.sh          # fixed port
WB_BROWSER=chrome ./start.sh  # another Chromium browser
./start.sh --no-restart       # never restart the browser; fails with instructions if extraction is needed
```

Credentials come from a real browser session. Two ways to provide them:

1. **Extracted from the browser** (recommended, `./start.sh` does it). `bun run creds` reads the access token
   from `localStorage["wbid-oauth-sdk-access-token"]` and captures the `x-userdata` header from the page's own
   network requests over the DevTools protocol, then writes `~/.config/wb-harness/credentials.json` (mode
   `0600`). Supported browsers: `helium` (default), `chrome`, `brave`, `edge`.
2. **Manually** via `.env` (`WB_TOKEN`, `WB_USERDATA`) copied from DevTools → Network → the chat request.

Env credentials win over the file. `GET /health` shows the source and the token expiry.

### Browser extraction

```sh
# Browser already started with --remote-debugging-port=9333
bun run creds -- --check

# Restart the browser once with the debugging port, extract, verify, then close the port again
bun run creds -- --browser helium --launch --check --restore

# Print .env lines instead of only writing the file
bun run creds -- --env
```

`--launch` quits the browser (macOS), relaunches it with `--remote-debugging-port=9333
--restore-last-session`, extracts credentials, and leaves it running. `--restore` restarts it again without
the debugging port. The port is unspecified anywhere else; pass `--port` or `--cdp` to override.

If extraction reports "no x-userdata header captured", open the AI chat on wildberries.ru once so the page
sends a request with that header, then rerun.

The token expires (typically in about a month). Rerun `bun run creds` when `/health` shows an expired token or
the upstream starts returning `401`.


## OpenCode

Copy `opencode.json` into your project (or merge it), start the harness, then run OpenCode with
`--model wildberries/wb-agent`. The provider is registered as an OpenAI-compatible endpoint at
`http://127.0.0.1:3001/v1`.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | OpenAI chat completions, supports `tools`, `stream` |
| `GET` | `/v1/models` | lists `wb-agent` |
| `POST` | `/api/chat/v5/message` | Wildberries-native proxy, returns upstream SSE |
| `GET` | `/health` | status, configured auth, registered tools |
| `GET` | `/debug/last` | last request metadata (no credentials) |

### Response metadata

Non-streaming responses and the final stream chunk include `wb_harness`:

```json
{
  "wb_harness": {
    "tools": ["read", "wb_product_link"],
    "enrichment": [{ "tool": "wb_product_link", "ok": true }],
    "scenario": "chat",
    "state": "success",
    "suggestions": ["..."],
    "fallback": false
  }
}
```

First tokens of a tool turn look like a normal OpenAI tool call:

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          { "id": "call_...", "type": "function", "function": { "name": "read", "arguments": "{\"filePath\":\"package.json\"}" } }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port |
| `HOSTNAME` | `127.0.0.1` | bind address |
| `WB_TOKEN` | — | bearer token (overrides the file) |
| `WB_USERDATA` | — | `x-userdata` blob (overrides the file) |
| `WB_CREDS_FILE` | `~/.config/wb-harness/credentials.json` | extracted credentials |
| `WB_UPSTREAM` | WB chat URL | override for tests |
| `WB_ENRICH` | `true` | run shopping tools before the model |
| `WB_TOOL_TIMEOUT_MS` | `4000` | tool timeout |
| `WB_SESSION_REUSE` | `true` | reuse upstream sessions |

## Tests

```sh
bun test
bun run typecheck:tsc
```

The suite covers SSE parsing, offer extraction, the tool planner, and the HTTP server against a local fake
upstream (tool calls, streaming, enrichment injection, refusal fallback, auth errors). No network access.
