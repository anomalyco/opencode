---
name: securecode-benchmark
description: Run SecureCode benchmarks under `benchmarks/securecode`, verify the generated artifacts, and report the exact run directory and key metrics. Use when the user asks to execute request/session capacity tests, NCC sweeps, smoke tests, or benchmark verification against an OpenAI-compatible endpoint.
---

# SecureCode Benchmark

## Overview

Use this skill to execute the benchmark assets in `benchmarks/securecode` and verify that the run completed cleanly.

Read [../../../benchmarks/securecode/README.md](../../../benchmarks/securecode/README.md) first. Open [../../../benchmarks/securecode/REPORT_AUTHORING_TIPS.md](../../../benchmarks/securecode/REPORT_AUTHORING_TIPS.md) only if the user also wants a human-facing report.

## Default workflow

1. Confirm whether the user wants:
   - request capacity: `benchmarks/securecode/scripts/run_securecode_capacity.sh`
   - session capacity: `benchmarks/securecode/scripts/run_securecode_session_capacity.sh`
2. Decide whether this is a normal sweep or a reproduction task.
   - If the user wants a heavier request profile to expose saturation more clearly, use `benchmarks/securecode/scripts/run_securecode_capacity_heavy_profile.sh`.
   - Otherwise use the normal capacity/session script.
3. Before running anything, make the artifact destination canonical.
   - Run from the repository root so relative paths and `.env` loading work.
   - Keep `SECURECODE_OUTPUT_ROOT` inside the repository by default, typically `${REPO_ROOT}/results`.
   - Do not redirect benchmark artifacts to `/tmp` unless the user explicitly asks for that.
   - If a local `benchmarks/securecode/.env` exists, respect it. If not, use the script default that resolves to `${REPO_ROOT}/results`.
4. If the endpoint is remote or expensive, do a small preflight or smoke run before a large sweep unless the user explicitly asked for the large run first.
5. Treat the default goal as finding the performance ceiling, not just collecting one arbitrary sweep.
6. If the first main sweep ends with `ceiling.status == not-reached` and the highest tested phase is still healthy, automatically extend the concurrency range and continue.
   - Prefer step-ups that keep the knee visible, for example `64 -> 96 -> 128 -> 160` or another monotonic extension that fits the observed curve.
   - Keep extending until one of these happens:
     - `observed-saturation`
     - `error-onset`
     - throughput gain clearly flattens while latency keeps worsening
     - the user gave an explicit cap on cost, time, or concurrency
7. Verify the generated artifacts in the canonical run directory:
   - `summary.json`
   - `phase_metrics.csv`
   - `phase_buckets.csv`
   - `raw_results.jsonl`
   - `charts/*.png` when chart rendering is available
   - if this is a reproduction task, compare `phase_metrics.csv` against the reference run before declaring success
8. Check chart quality before calling the run done.
   - `capacity_overview.png` must show the latency spike rate series or subplot clearly.
   - If the latency spike rate is truly zero across all phases, make sure the chart still renders a visible zero baseline or another explicit indicator.
   - If the latency spike rate area is blank because of rendering or scaling, fix the chart generation and regenerate before reporting success.
9. If anything landed outside the repository because of an explicit override, sync or copy the final run directory back under `results/` before you report success, unless the user explicitly asked to keep it elsewhere.
10. Summarize:
   - exact command
   - exact canonical run directory under `results/` when available
   - key throughput / latency numbers
   - whether the ceiling was actually reached
   - what was not covered

## Guardrails

- Never hard-code secrets into files. Prefer env vars or user-provided temporary values passed only to the process.
- Do not commit benchmark output unless the user explicitly asks.
- If remote monitoring is not configured, say that GPU / power / temperature findings are unavailable instead of guessing.
- If the run fails partway through, preserve partial artifacts and explain where it failed.
- Do not stop at a low healthy concurrency just because the initial list ended. For capacity work, stopping early is usually the wrong result.
- Do not ship a blank latency spike chart.
- Do not call a run “reproduced” just because the endpoint and model name match. Reproduction requires matching workload size, token cap, concurrency sweep, and telemetry conditions.
- Do not leave the only usable artifacts under `/tmp` when the user expects a reusable deliverable.
- For the heavy profile, do not substitute lighter settings such as `max_tokens=128`; that changes the benchmark.

## Common patterns

- Remote OpenAI-compatible endpoint:
  set `SECURECODE_BASE_URL`, `SECURECODE_MODEL`, and `SECURECODE_API_KEY`, then run the benchmark script.
- NCC or other managed GPU hosts:
  use request capacity first; keep extending concurrency until the ceiling is observed or an explicit run budget stops you; only add remote monitoring if the host-side monitor script is available.
- Heavier response profile:
  prefer `benchmarks/securecode/scripts/run_securecode_capacity_heavy_profile.sh`; verify that `avg_completion_tokens` stays around `359`, `request_count` is `576`, and the sweep reaches `384`.
- Validation after asset edits:
  prefer a smoke run with low concurrency and short cycles before a full sweep.
