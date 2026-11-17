# Testing

All commands run from `opencode/packages/rollover/` unless noted. The suite never touches the global OpenCode install; everything runs in `opencode-rollover-*` temp sandboxes with a local mock LLM.

## Suite

```bash
bun test                # 245 tests: unit + adapter + integration (gated ones skip)
bun run typecheck       # bun check --no-script
bun run lint            # oxlint
```

Current baseline: **245 tests, 244 pass / 0 fail / 1 gated skip**.

## Gated integration tests

Tests marked `OPENCODE_BIN gated` (bench smoke, scheduler runs against the real binary) skip cleanly without the env var. To run them:

```bash
OPENCODE_BIN=<fork>/packages/cli/dist/rollover-test/cli-darwin-arm64/bin/opencode \
  bun test tests/integration/bench-runner.test.ts
```

The path must point at the fork-built binary inside this repo (the guard rejects anything outside the fork tree).

## Performance gates (spec B §6)

```bash
bun test tests/perf/swap-latency.test.ts
```

Six cases × 20 iterations (small history, 500 messages, 5k-line ledger, tail 20, max render budget, repeats). Release bounds: **p95 < 250 ms, max < 5 s**; the transform path must never call the LLM (spy asserted 0). Results are written to `tests/perf/last-run.json`. Last run: p50 0.16 ms, p95 0.38 ms, max 2.82 ms (120 samples).

## Benchmark (spec §7)

Runs real scenario drives against the fork binary with the local mock LLM (`autoUsage`: input tokens = payload chars/4 so baseline/experimental totals reflect context growth):

```bash
OPENCODE_BIN=<fork binary> bun run bench/run-all.ts            # full matrix
OPENCODE_BIN=<fork binary> bun run bench/run-all.ts --from-raw # re-render report from raw-*.json
```

Matrix: B1/B2/B4 baseline+experimental; B6/B7/B9 experimental only; **B8/B10 are not run** (labeled in the report). Outputs: `bench/reports/raw-<id>-<mode>.json` + `bench/reports/rollover-benchmark.md` (§7.6 format; cost stays `null` because `bench/pricing.json` has no model prices by design — no invented prices).

Retention scoring (`bench/retention.ts`, unit-tested) matches hidden expected facts against the experimental run's ledger/render artifacts (token-Jaccard ≥ 0.4; substring for render) and reports recall/precision/F1 plus critical omission / wrong invalidation / unresolved open item / false claim flags.

## End-to-end smoke

The reusable driver builds a fresh sandbox, runs 5 turns against the real binary + mock, then asserts state, metrics, payload contents and the `/rollover` command path:

```bash
bash .superpowers/sdd/2026-11-15-rollover-opencode/smoke.sh
# exit 0 + "SMOKE PASS" on success; log lands next to the script
```

## Environment safety

Plugin work is restricted to this repo and `opencode-rollover-*` temp dirs; credential env vars are scrubbed in launcher/benchmark environments (rebuilt from scratch in `bench/runner.ts:sandboxEnv`). The fork tree must show only `M bun.lock` + untracked `packages/rollover/` after the work:

```bash
cd opencode && git status --short
```
