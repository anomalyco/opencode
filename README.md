# wb-harness

**An OpenAI-compatible bridge to the Wildberries AI assistant, built on top of [OpenCode](https://github.com/anomalyco/opencode).**

Wildberries ships a shopping assistant at `ai-proxy.wildberries.ru`. It has no public API, no tool calling, and no
developer documentation. This repository reverse-engineers its streaming protocol and wraps it in a local HTTP
service that speaks `POST /v1/chat/completions`, so any OpenAI-compatible client — including OpenCode — can use it
as a model.

> [!WARNING]
> This is educational reverse engineering. It uses **your own** Wildberries account token, it violates the
> Wildberries terms of service, and it can stop working at any time. Do not use it in production, do not use
> other people's accounts, and do not ship it as a product. You are responsible for how you use it.

> [!NOTE]
> This project is not affiliated with Wildberries, OpenCode, or their teams. `README.<lang>.md` files are
> inherited from upstream OpenCode and describe OpenCode core, not the harness.

---

## Why this exists

The Wildberries assistant is a decent shopping bot locked behind the website. Meanwhile OpenCode is a coding agent
that can already read files, run commands, and call tools. The interesting question is what happens when the two
meet: a shopping assistant with a filesystem, and a coding agent with a catalog.

The harness answers that in two layers:

1. **Model access** — the assistant's SSE protocol is wrapped as OpenAI chat completions, with sessions, streaming,
   rate-limit handling, and native Wildberries proxying for clients that want it.
2. **Tool layer** — the assistant cannot emit tool calls, so the harness plans them itself from the user's text and
   injects the results into the prompt as plain facts. Shopping lookups run against public Wildberries catalog
   endpoints before the model is called; coding tools are proposed to the client as ordinary OpenAI `tool_calls`,
   which the client executes and returns as `role: "tool"` messages.

Because the upstream model refuses content framed as a system prompt or an off-topic agent task, tool choice is
intent-based (path, command, and article parsing) rather than model-driven. When a tool result is off-topic for a
shopping bot — `git status`, for example — the assistant refuses to answer, and the harness returns the raw tool
output instead, flagged with `wb_harness.fallback: true`, so the agent loop can continue.

## Repository layout

| Path | What it is |
| --- | --- |
| `services/wb-harness` | The bridge. Bun HTTP server, protocol client, SSE parser, tool registry, credential extractor, tests. Start here. |
| `integrations/wb` | A self-contained OpenCode profile with two deterministic shopping tools. No monorepo build required. |
| everything else | The upstream OpenCode monorepo — TUI, server, SDK, desktop app, docs. Unmodified unless noted in `git log`. |

The two integrations are independent:

- **`services/wb-harness`** turns the Wildberries assistant into a model. Use it when you want the assistant's own
  answers, shopping enrichment, and tool calling inside any OpenAI client.
- **`integrations/wb`** runs OpenCode with local tools only. It links products and compares unit prices from data
  already in the request; it does not talk to Wildberries at all. Useful when you want no network dependency.

## How it works

```
┌──────────────────────┐        POST /v1/chat/completions        ┌──────────────────────────────┐
│ OpenCode, curl, any  │ ──────────────────────────────────────▶ │        wb-harness            │
│ OpenAI-compatible    │ ◀────────────────────────────────────── │        127.0.0.1:3001        │
│ client               │        OpenAI JSON / SSE chunks         │                              │
└──────────────────────┘                                         │  1. plan tool calls          │
                                                                 │  2. enrich with catalog data │
┌──────────────────────┐                                         │  3. call Wildberries         │
│ Tool results from    │ ── role: "tool" messages ─────────────▶ │  4. stream answer back       │
│ the client           │                                         └───────────┬──────────────────┘
└──────────────────────┘                                                     │
                                                                             ▼
                                                     ┌──────────────────────────────────────┐
                                                     │ ai-proxy.wildberries.ru  (SSE chat)  │
                                                     │ search.wb.ru             (catalog)   │
                                                     │ card.wb.ru               (details)   │
                                                     └──────────────────────────────────────┘
```

Requests are enriched with facts from the public catalog (`wb_product_link`, `wb_product_details`,
`wb_search_products`, `wb_compare_unit_prices`) and sent to the assistant over its native SSE protocol. The reply is
converted back into OpenAI format, including streaming deltas, usage-free chunks, and `wb_harness` metadata
(planned tools, enrichment status, scenario, moderation state, suggestions, fallback flag).

## Quick start

Requirements: [Bun](https://bun.sh), `curl`, and a Chromium-based browser where you are logged in to
`wildberries.ru`.

```sh
cd services/wb-harness
./start.sh
```

`start.sh` picks a free port, reuses valid credentials or extracts them from the browser (restarting it once if
needed), starts the server, and verifies a real completion before printing the endpoints. `Ctrl-C` stops it.

```sh
PORT=3005 ./start.sh          # fixed port
WB_BROWSER=chrome ./start.sh  # helium (default), chrome, brave, edge
./start.sh --no-restart       # never restart the browser; fail with instructions instead
```

Credentials are read from `localStorage["wbid-oauth-sdk-access-token"]` and captured as the `x-userdata` header from
the page's own requests over the DevTools protocol, then written to `~/.config/wb-harness/credentials.json` with
mode `0600`. They can also be supplied manually as `WB_TOKEN` and `WB_USERDATA`; environment variables win over the
file. Tokens expire after roughly a month — rerun `bun run creds` when `/health` reports an expired token or the
upstream returns `401`.

### Use it from OpenCode

Copy `services/wb-harness/opencode.json` into your project (or merge it), keep the harness running, and select the
`wildberries/wb-agent` model:

```sh
opencode --model wildberries/wb-agent
```

The provider is registered as an OpenAI-compatible endpoint at `http://127.0.0.1:3001/v1`.

### Use the local profile instead

```sh
cd integrations/wb
./opencode-wb run --model '<provider/model>' \
  'Дай ссылку на артикул 123456. Что дешевле за штуку: 2 за 300 ₽ или 4 за 400 ₽?'
```

See [`integrations/wb/README.md`](integrations/wb/README.md) for the HTTP mode and how to add tools.

## HTTP API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | OpenAI chat completions; supports `stream` and `tools`. |
| `GET` | `/v1/models` | Lists `wb-agent`. |
| `POST` | `/api/chat/v5/message` | Transparent Wildberries-native proxy returning upstream SSE. |
| `GET` | `/health` | Status, credential source, token expiry, registered tools. |
| `GET` | `/debug/last` | Metadata of the last request, without credentials. |

Configuration is environment-based: `PORT`, `HOSTNAME`, `WB_TOKEN`, `WB_USERDATA`, `WB_CREDS_FILE`, `WB_UPSTREAM`,
`WB_ENRICH`, `WB_TOOL_TIMEOUT_MS`, `WB_SESSION_REUSE`. The full table and response examples live in
[`services/wb-harness/README.md`](services/wb-harness/README.md).

## Limitations

- **The upstream is a shopping bot.** It moderates and refuses prompts that look like system prompts, tool
  protocols, shell access, or unrelated agent tasks. The harness routes around this with intent-based planning and
  a raw-output fallback, but the model's own answers stay shopping-oriented.
- **No native tool calls.** Planned calls are heuristic: they work well for explicit requests like
  "прочитай файл src/index.ts", "запусти git status", or "найди все файлы *.ts", and fall through to the model for
  everything else.
- **Undocumented and unstable.** Headers, SSE frame types, rate limits, and catalog endpoints were discovered by
  observation. They can change or disappear without notice.
- **Not a product.** There is no SLA, no multi-user auth, no secret storage beyond a local file, and no guarantee
  that any of this remains within anyone's terms of service.
- **Rate limits are real.** The upstream answers `429` with `retry-after`; the harness forwards that instead of
  hammering the API.

## Development

```sh
cd services/wb-harness
bun install
bun test                 # SSE, planner, enrichment, HTTP server against a local fake upstream
bun run typecheck:tsc
```

The test suite needs no network access. For the OpenCode profile:

```sh
cd integrations/wb
bun test ./smoke.test.ts
```

Repository-wide checks and contribution rules follow upstream OpenCode: see [`AGENTS.md`](AGENTS.md),
[`CONTRIBUTING.md`](CONTRIBUTING.md), and [`SECURITY.md`](SECURITY.md). Do not commit credentials, extracted
tokens, or browser profiles.

## License

MIT, inherited from [OpenCode](https://github.com/anomalyco/opencode). See [`LICENSE`](LICENSE).

Wildberries, the Wildberries logo, and related marks belong to their owners. This project claims no rights to them
and is not endorsed by Wildberries.
