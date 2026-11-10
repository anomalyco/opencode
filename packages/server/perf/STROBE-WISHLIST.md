# Strobe wishlist: diagnose a saturated server

`script()` already measures the real server without charging the SDK client or model fixture to it. The missing piece is answering **which thread was busy, doing what, and could another client get a response at that moment?** on one timeline.

## 1. Scope script profiles to measured work

- **Reproduce:** `strobe record --bench 'packages/server/perf/agents.bench.ts#concurrent agent trees' --head . --params parents=2,children=20,interval=5 --runs 1`. In Strobe 0.23.0 recording `rec_33e8b2`, the measured run is 6.94 s. The hotspots cover the ~65 s host lifetime. `meta.json.note` confirms this includes start, setup and warmup.
- **Build:** start/stop Bun or Node sampling around each measured `run`, or clip samples to synchronized run boundaries. Retain run and phase marks. `query hotspots --phase`, `report` and `open` must agree on the range. Record the actual sampling interval and keep the current whole-host view explicitly labeled.
- **Accept:** burn CPU in three distinct named functions during setup, run and reset. Only the run function appears in measured hotspots; all three appear in the whole-host view. A failed run cannot produce a valid partial profile.

## 2. Measure the main thread separately from the tree

- **Problem:** `cpu.app.total` can be over 100% while the server's JavaScript thread is well below 100%. Git subprocesses and runtime helpers contribute. A separate `record pid:…` shows threads but needs a second capture aligned by hand.
- **Build:** expose runtime main-thread CPU milliseconds and occupancy beside tree `cpu.work` in headless script blocks. Identify the main thread at launch, not by busiest thread or window ownership. Retain per-second deltas, actual elapsed durations, PID/TID, and run boundaries. Where no reliable counter exists, return a typed refusal.
- **Accept:** compare a main-thread spin, worker spin, CPU-heavy child and timer wait. Only the first saturates the main thread; the first three consume tree CPU. Blocking the event loop must not discard a late sample's elapsed time.

## 3. Correlate independent request latency with CPU

- **Problem:** receiving every completion does not mean the server remained responsive. The 10×10 workload completed successfully even when a trivial authenticated API request took over one second.
- **Build:** let setup declare a loopback probe, authorization (never persisted), cadence, timeout and response predicate. Send from outside the target on absolute deadlines without waiting for prior responses. Retain scheduled, sent and completed times, skipped probes, errors, p50/p95/max and an idle control. Overlay requests and thread samples in Perfetto. Keep this probe out of clean timing blocks by default.
- **Accept:** block the server's main thread for 750 ms with probes every 100 ms. Show the affected cohort, not a single slow request followed by a gap. Delay the **driver** instead: mark missed sends, not server stalls. HTTP 500 and timeout must not count as fast successes.

The [diagnostic probes](./diagnostics.ts) and [workload-only sampler](./server.ts) are working examples of the evidence needed, not proposed changes to the OpenCode server API.
