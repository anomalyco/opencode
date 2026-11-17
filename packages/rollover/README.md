<div align="center">

# context-rollover

**Durable memory ledger + context rollover for [OpenCode](https://opencode.ai) sessions.**

[![npm version](https://img.shields.io/npm/v/context-rollover.svg)](https://www.npmjs.com/package/context-rollover)
[![license](https://img.shields.io/npm/l/context-rollover.svg)](https://www.npmjs.com/package/context-rollover)
[![tests](https://img.shields.io/badge/tests-343%20passing-brightgreen.svg)]()

Keeps long sessions inside the model's context window by freezing history
into a compact ledger summary — rendered as `<rollover_context>` — instead of
auto-compacting. Fail-open by design: every failure path keeps the
conversation intact.

<img src="https://raw.githubusercontent.com/omeryasirkucuk/context-rollover/main/docs/rollover.png" alt="Without rollover: growing context, forced compaction, lost continuity. With rollover: controlled context, preserved knowledge, continuous sessions." width="720">

</div>

## Why

Long agent sessions hit the context window. Auto-compaction throws away
detail; rollover instead **extracts what still matters** into a durable
ledger, and rewrites what the model sees — so the session can run
indefinitely without losing decisions, corrections, or open work.

## How it works

```
 session ──▶ extraction gate ──▶ extraction ──▶ ledger ──▶ swap ──▶ <rollover_context>
             (12 rules, 0 LLM)   (small model)  (append-only)  (budgeted render)
```

<p align="center">
  <img src="https://raw.githubusercontent.com/omeryasirkucuk/context-rollover/main/docs/rollover-flow.png" alt="Context grows to the threshold, then rolls over; pipeline: conversation → extraction gate → memory ledger → context swap — same session continues" width="720">
</p>

- **Extraction gate** — before any model call, the pending turn is classified
  by 12 deterministic first-match rules (correction, standing instruction,
  open item, completion, decision, constraint, task, process start, closure,
  question, example, default). SKIP/DEFER verdicts cost **zero tokens** and
  never drop content: the cursor stays put, so `buildDelta` accumulates
  everything skipped into the next run. Measured on a 20-turn replay:
  **20 → 7 calls (−65%)**, 32/32 meaningful records covered.
- **Extraction** — a small-model call distills each new conversation delta
  into ledger records: `objective`, `decision`, `user_correction`,
  `open_item`, `verification`, `file`.
- **Swap** — when the context estimate crosses the threshold, history rolls:
  active records render into a budgeted `<rollover_context>` block, the last
  *N* prompts stay verbatim, and everything from the cutoff onward stays
  intact. The rewrite is never persisted — every request gets a fresh
  projected copy, so UI and session history are untouched.

## Install

```
opencode plugin add context-rollover
```

That's it — opencode installs the package (and its peer dependencies) into
its plugin cache, registers it in your global config, and loads it on the
next start. Verify with `/rollover status` in any session.

Updates: `opencode plugin update context-rollover`.

## Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `mode` | `"off" \| "metrics_only" \| "auto"` | `"off"` | Every session starts off and opts in per chat with `/rollover` (or `/rollover on`); a rollover.json / `ROLLOVER_MODE` can still set a project- or global-wide default. `off` disables everything; `metrics_only` records metrics without swapping; `auto` is full behavior |
| `thresholdTokens` | number | *computed* | Swap threshold; computed from the model's context limit (`thresholdRatio`, capped/floored) when omitted |
| `tailN` | number | `0` | Prompts kept verbatim after a swap (`0–20`) |
| `renderBudgetTokens` | number | `4000` | Token budget for the rendered `<rollover_context>` block (per-session override: `/rollover --render 10k`) |
| `extractionModel` | `"provider/model"` | *small model* | Model used for extraction; falls back to the session model |
| `consolidateAfterRecords` | number | `40` | Run consolidation once the ledger holds this many active records |
| `extractionGate` | boolean | `true` | `false` restores extraction on every idle (pre-gate behavior) |

## Commands

| Input | Effect |
|---|---|
| `/rollover` | Activate auto mode for this session (status card + confirmation). When already running it says so and changes nothing |
| `/rollover status` | Status card only — mode, threshold, context, ledger size, last rollover |
| `/rollover show` | Active ledger records + invalidations |
| `/rollover 80k` | Set per-session threshold (validated against the model limit) |
| `/rollover -n 5` | Tail prompts kept verbatim after a swap (`0–20`) |
| `/rollover 200k -n 5` | Both together — threshold and tail in one command |
| `/rollover --render 10k` | Set the per-session render budget for the `<rollover_context>` block (min `1k`) |
| `/rollover on` · `/rollover off` | Per-session opt-in/out of the full pipeline (overrides every config layer) |

## Metrics

Append-only JSONL events in `metrics.jsonl`; totals are event counts.

| Event | Meaning |
|---|---|
| `gate_classified` | One per classification — `cls`, `decision`, `urgent`, `rule`, `pendingMessages`, `pendingTokens` gauges |
| `gate_scheduled` | A classification led to an actual scheduled extraction run |
| `gate_coalesced` | An EXTRACT candidate merged into existing/in-flight work (or in-flight dedupe) |
| `gate_fallback` | Gate error → pre-gate behavior used (extraction ran anyway) |
| `llm_call` | One per LLM attempt (extraction + consolidation retries visible) — `purpose`, `model`, `latencyMs`, `ok`; `usage: null` means the generate host exposes no usage, reported unavailable rather than zero |
| `extraction_started` / `completed` / `failed` | Actual extraction execution; the cursor advances only on success |

## State on disk

Per session, under the project's `.opencode/rollover/<sid>/`:

| File | Contents |
|---|---|
| `state.json` | epoch, extraction cursor, rollover record, settings, touched files |
| `ledger.jsonl` | append-only records + invalidations |
| `metrics.jsonl` | swap / deferred / extraction / consolidation events (+ diagnostics) |

## Documentation

| Document | Contents |
|---|---|
| [`docs/spec.md`](docs/spec.md) | Authoritative spec (unified A+B) |
| [`docs/decisions.md`](docs/decisions.md) | D1–D10 implementation decisions |
| [`docs/phase0-findings.md`](docs/phase0-findings.md) | Empirically verified 2.x API surface (P0-1…P0-13) |
| [`docs/testing.md`](docs/testing.md) | Test suite, perf gates, benchmark — how to run them |
| [`docs/known-limitations.md`](docs/known-limitations.md) | Honest list of what remains |
| [`bench/reports/rollover-benchmark.md`](bench/reports/rollover-benchmark.md) | Measured benchmark report (+ `raw-*.json`) |

## Development

```bash
git clone https://github.com/omeryasirkucuk/opencode.git
cd opencode/packages/rollover
bun install
bun test          # 343 tests
bun run typecheck
```

## License

[MIT](https://www.npmjs.com/package/context-rollover)
