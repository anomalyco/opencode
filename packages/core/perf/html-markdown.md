# HTML to Markdown renderer

## Goal

Replace Turndown and Domino in V2 Core only when an htmlparser2 event renderer preserves model-readable semantics and improves resource use and shipped size.

## Commands

- `bun run test tool-webfetch.test.ts` from `packages/core`
- `bun build --entrypoints src/tool/html-markdown.ts --outdir <dir> --target node --format esm --minify`
- `bun run build --single --skip-install` from `packages/cli`

## Metrics

- Primary: median conversion throughput after one warmup and nine measured runs.
- Secondary: min/max spread, minified/gzip bundle size, CLI artifact size, and peak RSS where practical.

## Experiment Log

| Experiment | Hypothesis | Before | After | Decision |
| --- | --- | --- | --- | --- |
| Event renderer | Avoiding Domino's DOM lowers conversion cost while retaining semantics. | Turndown 4.23 MiB/s median (72.55 ms, 66.93-109.75) | Candidate 10.12 MiB/s median (30.32 ms, 22.29-83.55) | Keep: 2.39x throughput |
| Safe fences | Fence length derived from code content prevents embedded backticks from closing blocks. | Turndown emitted triple fences around embedded triples | Candidate expands to four backticks | Keep |
| Tables | Row/cell events retain tabular relationships better than flattened cell blocks. | Turndown flattened cells | Candidate emits GFM-readable tables | Keep |
| Malformed inline blocks | Delimiters spanning implied block closes produce malformed Markdown. | Candidate left open emphasis | Candidate drops the delimiter and preserves visible text | Keep |

## Evaluation

Temporary snapshots from Example Domain, MDN's table reference, Python asyncio documentation, RFC 9110, and W3C's forms tutorial were evaluated on 2026-08-12. Candidate output retained the same heading counts on four sites and one additional visible MDN heading, the same link counts on three sites, two additional Python links, and the same fenced-code counts where Turndown recognized fences. Candidate output was 0-3.6% smaller; tables and preformatted code were more explicit. Snapshots and generated output are not committed.

The minified isolated evaluation bundle containing Turndown, Domino, htmlparser2, and both renderers was 311,557 bytes (98,680 gzip). The candidate renderer with htmlparser2 was 61,293 bytes (26,922 gzip). Installed Turndown plus Domino occupied 9,028 KiB; htmlparser2 was already required by Core.

The same-commit macOS arm64 CLI executable was 87,338,978 bytes with Turndown and 87,091,298 bytes with the candidate, a 247,680-byte reduction.

Real-site HTML is temporary evaluation data and is not committed.
