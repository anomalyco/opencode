# oclite — performance record (final, Phase 7)

This covers the SPEC primary constraints. #1 is fixed overhead per request: ≤ 1200 tok for `local`, ≤ 600 for
`local-min` and ≤ 7300 for `default` (lead decision, PROGRESS Deviations). #2 is visible progress: a status line
within 300 ms, and each stream part rendered within 50 ms of arrival. Numbers were taken at HEAD `3504985` plus the
Phase 7 profile changes, on 2026-09-28, with Bun 1.3.10 on darwin.

## 1. Fixed token overhead

### Method
- `oclite debug prompt --tokens --profile <p>` composes the real first request, using the same code path as
  `Runtime.start`: `tools/registry.ts` builds the ToolSet, `runtime/context.ts` layers the system prompt, and MCP
  goes through `mcpForRun`. The agent is `build` and the user message is `"."`.
- Request A (system + tools, `max_tokens: 1`) and request B (no system, no tools) both go through `LlmGateway`.
  `fixed = A.prompt_tokens − B.prompt_tokens`, as reported by the server for an empty conversation.
- The server is `test/lib/local-server.ts`. Its `prompt_tokens` is `ceil(chars / 4)` of the rendered request (system
  text, then tools JSON, then the other messages), so the results are deterministic. A real tokenizer will differ by
  roughly ±10–25%.
- Capabilities are pinned to native tools (`tools_native: true`, etc.). Unpinned, the probe meets the fake's empty
  reply queue, detects text-protocol mode and undercounts.
- MCP means the `test/fixture/mcp-everything.ts` stdio server (6 tools) is configured. `local` and `local-min` defer
  MCP behind `tool_search`, while `default` sends every schema.
- The env block includes the temp project's cwd (about 70 chars), so another cwd shifts these by a few tokens.
  Enforced by `test/profile/budget.test.ts` (`debug prompt --tokens --check`, plus the tighter limits below).

### Results (tok, server-reported)

| profile | no MCP (before → after) | MCP (before → after) | test limit | SPEC budget |
|---|---|---|---|---|
| local | 1128 → **951** | 1191 → **1011** | 1000 / 1050 (MCP) | 1200 |
| local + `task` enabled | 1318 → **1123** | 1381 → **1184** | 1200 (MCP) | 1200 |
| local-min | 478 → **420** | 541 → **480** | 450 / 500 (MCP) | 600 |
| default (opencode texts) | 7259 | 7625 | 7300 (no MCP) | 7300 |

"Before" is the Phase 3–6 profile text. "After" is the Phase 7 rewrite, which only touches `src/profile/*`.

The opencode baseline is ≈ 7,260 tok. The `default` profile sends opencode's own texts byte for byte:
`session/prompt/default.txt` (8,528 chars, since an unknown local model id falls back to it) and the tool `.txt`
files. Those are bash via `ShellPrompt.render` (4,629), edit 1,369, read 1,158, task 2,305, todowrite 2,012,
webfetch 750, grep 657, write 623, glob 517 and skill 399. Add the parameter schemas and the env block and the
total is 7,259 tok measured, which matches SPEC's ≈ 7,300 estimate. Against that baseline, `local` saves 87% and
`local-min` saves 94%.

**Flag:** `default` with MCP configured is 7,625 tok, over 7300, because it sends all 6 fixture schemas. The spec
baseline has no MCP, and the budget test checks `default` without MCP. Keeping `default` under 7300 with MCP would
need the deferred `tool_search` there too. That's a lead decision.

### What changed in Phase 7

| asset | before (chars) | after (chars) |
|---|---|---|
| `local.txt` | 507 | 297 |
| `local-min.txt` | 162 | 108 |
| `tools.local.json` bash / edit / glob / grep / read / write | 267 / 202 / 124 / 151 / 138 / 116 | 108 / 109 / 60 / 73 / 86 / 67 |
| `tools.local.json` task / tool_search | 226 / 61 | 158 / 50 |
| `tools.local-min.json` bash / edit / grep / read / tool_search | 112 / 82 / 88 / 85 / 61 | 38 / 52 / 51 / 48 / 50 |

Every description still says what the tool does and names its key parameters (for example `filePath`, `oldString`,
`include`, `offset`/`limit`, `subagent_type`, `background`). Text the registry already sends in per-parameter
schema descriptions (timeout units, workdir semantics, default paths) was cut from the tool descriptions.

In `local`, the remaining overhead is mostly schemas. Per-parameter descriptions from `tools/*` are about 2.5 KB
(≈ 620 tok) and are outside `src/profile`. They're the next lever if more headroom is needed. `local-min` already
drops them (`registry.ts` `terse`).

## 2. Progress latency (`test/render/render.test.ts`)

| metric | target | measured |
|---|---|---|
| first status line on stderr, from spawn | ≤ 300 ms | 144–174 ms |
| per-event render latency (stream-json, server send → line written) | ≤ 50 ms | ≤ 5 ms |

## 3. TTFT: PENDING (no live server)

No live local server was available: `http://127.0.0.1:8000/v1` (`local-qwen`) refused connections throughout (see
PROGRESS Deviations). The fake's TTFT is simulated prefill (`prefill_ms_per_kchar`), so it doesn't count as a real
number. It shows the mechanism only: the probe measures 58 ms on the first request and 13 ms on the second with the
same prefix. To take the real before/after measurement:

```sh
# config: provider.local.options.baseURL = "http://127.0.0.1:8000/v1", model "local/local-qwen", no pins
bun src/index.ts debug server --reprobe          # ttft_ms "R2 → R3": cold vs warm prefix, prefix_cache verdict
bun src/index.ts debug prompt --tokens --profile local       # real-tokenizer fixed overhead, per profile
bun src/index.ts debug prompt --tokens --profile default     # "before": opencode-sized prefix
# TTFT per profile, first turn (cold) then second turn (warm prefix), stream-json timestamps:
bun src/index.ts -p "list files" --profile local --output-format stream-json | head -5
bun src/index.ts -p "list files" --profile default --output-format stream-json | head -5
```

For each, record the time from spawn to the first `text_delta`/`reasoning_delta` line (3 runs, cold and warm).
Prefill scales with prompt size, so ≈ 7.3k → ≈ 1k fixed tokens should cut cold TTFT roughly in proportion. Results:

| server / model | profile | fixed (tok) | TTFT cold / warm (ms) |
|---|---|---|---|
| _pending_ | | | |

## 4. Prefix-cache byte stability

- **Guarantee:** for one session, the system prompt and tool list are byte-identical on every request, so a server's
  prefix/KV cache is reused across turns.
- **How it's kept:**
  - The system prompt is composed once per run.
  - Tools are sorted by name.
  - The env block carries the date only, with no time.
  - Volatile content (reminders, todos, background completions) goes only in the last user message.
  - MCP tools activated by `tool_search` join later requests without reordering earlier bytes.
  - Server instructions arrive in the `tool_search` result, not in the system prompt.
  - `prompt_cache_key = session_id` is sent when the server accepts it.
- **Tests:**
  - `test/llm/fallback.test.ts` "byte-stable prefix": two requests in one session send identical system and tools
    bytes plus the same `prompt_cache_key`.
  - `test/profile/profiles.test.ts` "byte-stable composition": same bytes on repeated composition, tools sorted, env
    has the date only and no `HH:MM`.
  - `test/runtime/loop.test.ts`: system bytes are identical across turns.
  - `test/runtime/context.test.ts`: fixed layer order.
  - `test/tools/registry.test.ts`: definitions sorted and stable.
  - `test/mcp/client.test.ts`: the system prompt stays stable after activation.
- **prefix_cache detection:** the probe sends the same ~2k-token prompt twice (R2, R3), and a second TTFT at or below
  0.7× the first means a cache is present. It's a heuristic. The reliable path is to pin
  `servers[<base URL>].capabilities.prefix_cache`.
