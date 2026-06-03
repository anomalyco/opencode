# OpenAI-compatible gateway

This group turns the opencode server into an OpenAI-compatible model **gateway**
(think OpenRouter, but local and using the credentials you already configured in
opencode). Any OpenAI client can list and call every model from every enabled
provider. Requests are passed straight through to the underlying model — the
opencode **agent loop does not run**, so the calling client (e.g. VSCode) keeps
ownership of tool execution.

## Endpoints

All endpoints live under the server root (no extra prefix):

| Method | Path                   | Description                                                        |
| ------ | ---------------------- | ------------------------------------------------------------------ |
| GET    | `/v1/models`           | OpenAI `list` of every model as `providerID/modelID`.              |
| POST   | `/v1/chat/completions` | OpenAI Chat Completions. Streaming (SSE) and non-streaming. Tools pass through. |
| GET    | `/v1/vscode-config`    | Helper: a ready-to-paste VSCode `chatLanguageModels.json`.         |

The `model` field uses opencode's `providerID/modelID` form, e.g.
`anthropic/claude-sonnet-4-5`. `/v1/models` is the source of truth for valid ids.

## Running the server

The server port defaults to an ephemeral port, so pin it for a stable URL:

```bash
OPENCODE_SERVER_PASSWORD=sk-local-secret opencode serve --port 4096 --hostname 127.0.0.1
```

Run it from the directory whose opencode config/providers you want to expose
(when no `directory` is supplied the gateway resolves against the server's cwd).

## Authentication

VSCode's custom endpoint sends `Authorization: Bearer <key>`. The gateway treats
that bearer token as the server **password** (`OPENCODE_SERVER_PASSWORD`):

- No password set → the server is unsecured and every request passes through.
- Password set → the VSCode API key must equal `OPENCODE_SERVER_PASSWORD`.

## Using it from VSCode (Bring your own key)

1. Start the server (above).
2. VSCode → command palette → **Chat: Manage Language Models** → **Add Models** →
   **Custom Endpoint** → **Chat Completions**.
3. Base URL `http://localhost:4096/v1` (or the full
   `http://localhost:4096/v1/chat/completions`, depending on your VSCode version),
   API key = `OPENCODE_SERVER_PASSWORD`.
4. VSCode calls `/v1/models` and populates the picker.

To skip hand-writing config, fetch a generated `chatLanguageModels.json`:

```bash
curl -s http://localhost:4096/v1/vscode-config -H "Authorization: Bearer sk-local-secret" | jq
```

Example entry:

```json
[
  {
    "id": "anthropic/claude-sonnet-4-5",
    "name": "opencode: Claude Sonnet 4.5",
    "url": "http://localhost:4096/v1/chat/completions",
    "apiType": "chat-completions",
    "toolCalling": true,
    "vision": true,
    "maxInputTokens": 200000,
    "maxOutputTokens": 32000
  }
]
```

## Quick checks

```bash
# list models
curl -s http://localhost:4096/v1/models -H "Authorization: Bearer sk-local-secret" | jq

# non-streaming
curl -s http://localhost:4096/v1/chat/completions -H "Authorization: Bearer sk-local-secret" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet-4-5","stream":false,"messages":[{"role":"user","content":"hi in 3 words"}]}' | jq

# streaming
curl -N http://localhost:4096/v1/chat/completions -H "Authorization: Bearer sk-local-secret" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet-4-5","stream":true,"messages":[{"role":"user","content":"count to 5"}]}'
```

## Files

- `groups/gateway.ts` — endpoint declarations + middleware.
- `handlers/gateway.ts` — request handling (`handleRaw`), routing, streaming.
- `gateway/openai-convert.ts` — pure OpenAI ⇄ AI SDK conversion (unit-testable).
- `middleware/gateway-authorization.ts` — Bearer-aware auth.
