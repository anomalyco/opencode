# Capture Matrix Performance

## Goal

Minimize authoritative three-theme capture wall time without sharing OpenCode driver state between themes or publishing partial results.

## Benchmark

```sh
bun run bench:capture-matrix
```

Primary metric: `capture_matrix_total_ms`. Correctness requires identical ordered screen coverage for Opencode, Tokyo Night, and Everforest before publication.

## Baseline

- Sequential three-theme capture: 465,542 ms
- Output: 65 screens per theme, 195 frames total

## Experiment 1: Process-Isolated Theme Workers

Hypothesis: theme captures can run concurrently when each owns a separate Bun process and `OpenCodeDriver` lifecycle. Earlier in-process concurrency was discarded because LLM and permission timing became nondeterministic.

The coordinator now starts up to three theme workers, collects their staged outputs in requested order, and publishes only after every worker succeeds. A failed worker leaves the existing public manifest untouched.

Final clean parallel run: 170,584 ms, a 2.73x speedup over the 465,509 ms sequential control. The first publication attempts exposed aggregation contract bugs; both were caught by generation validation and fixed before deployment. The final run captured and generated all 65 screens for each theme successfully.

## Dead Ends

- In-process variant concurrency: discarded after repeatable permission and LLM synchronization failures.
- Sharing one driver across scenarios: discarded because tool-result continuations leaked between scenario queues.
