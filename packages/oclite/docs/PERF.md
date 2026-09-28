# oclite — performance record

Primary constraint #1 (SPEC): fixed per-request overhead (system prompt, tool schemas, injected reminders, with no
conversation) must stay ≤ 1200 tok in `local`, ≤ 600 in `local-min` and ≤ 7300 in `default` (lead decision, see
PROGRESS Deviations). The baseline to beat is opencode at about 7,200–7,300 tok for the same setup.

## Method

`oclite debug prompt --tokens` (`src/cli/debug.ts`, ARCHITECTURE §9):

1. Build the first-turn request for the default agent (`build`) and the chosen profile, with user message `"."`.
2. Send request A (system + tools, `max_tokens: 1`) and request B (the same with no system and no tools) through
   `LlmGateway.stream`, so they're queued and shaped like any other turn.
3. `fixed = A.usage.input − B.usage.input`, taken from the server's `prompt_tokens`. When `usage_in_stream` is false,
   the gateway estimates the value (llama.cpp `/tokenize` when available, else chars/4) and the output is labelled
   `est.`.
4. `--check` exits 1 when `fixed > budgetTokens`. `test/profile/budget.test.ts` runs this for every profile.

The server here is `test/lib/local-server.ts`. Its `prompt_tokens` is `ceil(chars/4)` of the rendered request
(system text, then tools JSON, then the other messages as JSON), so these numbers are deterministic and match a chars/4
estimate of the same bytes. A real tokenizer usually comes out 10–25% off chars/4 for English prose and JSON. The
margins below are meant to absorb that.

Composition used for the measurement (a stand-in until the lead integrates `runtime/context.ts` and
`tools/registry.ts`):
- System = harness prompt (profile) + agent prompt + env block (`cwd`, `platform`, `date: YYYY-MM-DD`, `git branch`).
  There are no instruction files (no AGENTS.md in the test project) and no reminders on the first turn.
- Tools = the profile list, sorted by name, plus `AgentDef.tools ∩ optionalTools`. Descriptions come from
  `profiles.descriptions()`; the default profile uses opencode's `.txt` files, with bash from
  `ShellPrompt.render`. Schemas are minimal JSON Schemas with opencode's parameter names and **no per-parameter
  descriptions**.

## Results (2026-09-28, fake server, model `local/test-model`, agent `build`)

| profile | budget | fixed (server-reported) | headroom | system chars | tool desc chars | schema chars | tools |
|---|---|---|---|---|---|---|---|
| local | 1200 | **794 tok** | 406 | 857 | 998 | 848 | bash edit glob grep read write |
| local-min | 600 | **452 tok** | 148 | 512 | 367 | 617 | bash edit grep read |
| default | 7300 | **6653 tok** | 647 | 8878 | 15076 | 1517 | bash edit glob grep question read skill task todowrite webfetch write |
| default (claude model id → anthropic.txt) | 7300 | 6574 tok | 726 | 8562 | 15076 | 1517 | same |

Harness prompt sizes: `local.txt` is 507 chars (cap 600) and `local-min.txt` is 162 chars (cap 300). The rest of the
system prompt is the `build` agent prompt (about 200 chars) and the env block (about 120 chars, depending on the cwd).

Per-tool description chars:

| tool | local (≤300) | local-min (≤150) | default (opencode .txt) |
|---|---|---|---|
| bash | 267 | 112 | 4,629 (`ShellPrompt.render`) |
| edit | 202 | 82 | 1,369 |
| glob | 124 | 54 | 517 |
| grep | 151 | 88 | 657 |
| read | 138 | 85 | 1,158 |
| write | 116 | 60 | 623 |
| task | 226 | 79 | 2,305 |
| todowrite | 161 | 50 | 2,012 |
| question | 133 | 48 | 657 |
| skill | 83 | 43 | 399 |
| webfetch | 104 | 38 | 750 |
| tool_search | 109 | 61 | – (MCP deferred only) |

Against the opencode baseline of about 7,300 tok, `local` cuts fixed overhead by about 89% and `local-min` by about
94%. `default` keeps opencode's texts byte-for-byte, so it lands near the baseline by design. It comes in a little
under because oclite sends no skills/env extras and uses leaner schemas.

## Things that could move these numbers

- **Registry schemas.** If `tools/registry.ts` emits per-parameter `description` fields (opencode's schemas have
  them, about 40–150 chars each), `local` could gain roughly 150–300 tok. That would still fit under 1200. For
  `local-min` it might be worth keeping parameter descriptions off, since the headroom there is only about 150 tok.
- **Instruction files.** AGENTS.md is capped per file at 2000 chars (local) or 1000 chars (local-min), which is up
  to about 500 / 250 tok per file. With one capped file, `local-min` would go over 600. I think that's in line with
  the spec, which measures the budget with no AGENTS.md, but it's worth confirming with the lead.
- **Optional tools** enabled per agent (`task`, `todowrite`, …) add about 60–100 tok each in `local`.
- **MCP:** local profiles send only `tool_search` (about 50 tok) until tools are activated.

## Live-server numbers: pending

There's no model server at `http://127.0.0.1:8000/v1` (connection refused on 2026-09-28, see PROGRESS
Deviations), so every number above comes from the fake. Once a server is available, record for each profile:
`oclite debug server` (capability record + TTFTs), then `oclite debug prompt --tokens --profile <p>`
(server-reported fixed overhead from the real tokenizer). Add a row per model below.

| server / model | profile | fixed (tok) | notes |
|---|---|---|---|
| _pending_ | | | |
