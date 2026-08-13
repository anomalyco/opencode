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

| Experiment              | Hypothesis                                                                                                                    | Before                                                                       | After                                                                                                                                               | Decision               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Event renderer          | Avoiding Domino's DOM lowers conversion cost while retaining semantics.                                                       | Turndown 4.75 MiB/s median (64.60 ms, 62.51-76.02)                           | Candidate 19.28 MiB/s median (15.92 ms, 14.51-20.58)                                                                                                | Keep: 4.06x throughput |
| Safe fences             | Choosing the shorter bounded backtick or tilde fence prevents embedded markers from closing blocks without amplifying output. | Turndown emitted triple fences around embedded triples                       | Candidate chooses the shorter marker and accounts for the full quoted fence within the content budget                                               | Keep                   |
| Tables                  | Row/cell events retain tabular relationships better than flattened cell blocks.                                               | Turndown flattened cells                                                     | Candidate emits GFM-readable tables                                                                                                                 | Keep                   |
| Malformed inline blocks | Delimiters spanning implied block closes produce malformed Markdown.                                                          | Candidate left open emphasis                                                 | Candidate drops the delimiter and preserves visible text                                                                                            | Keep                   |
| Regex depth prepass     | A whole-input tag regex can backtrack quadratically on repeated malformed prefixes.                                           | 2 MiB `<a` input exceeded 120 seconds                                        | Single chunked htmlparser2 pass handles 5 MiB in 37.47 ms                                                                                           | Keep                   |
| Output budget           | Escaping and fence selection must not amplify a response beyond webfetch's input ceiling.                                     | Escapable prose could nearly double; backtick fences were unbounded          | Output is capped at 5 MiB during writes; buffered tables refund captured bytes; inline/table/code constructs reserve closers or truncate atomically | Keep                   |
| Depth fallback          | Parser-depth limits must not leave suppressed or preformatted state active.                                                   | Depth cutoff could leak suppressed content or swallow following visible text | Fallback tracks suppressed/omitted depth and clears code capture before text degradation                                                            | Keep                   |
| Real-site structure     | Purpose-built output must preserve documentation semantics rather than merely look Markdown-like.                             | Wikipedia/RFC tables and definition lists collapsed or parsed as paragraphs  | Captions separate from tables, spans use row fallback, dl/dt/dd emit readable boundaries, hidden/head/closed-details content is suppressed          | Keep                   |

## Evaluation

Temporary snapshots from Wikipedia's Markdown article, MDN's table reference, Python asyncio documentation, RFC 9110, and W3C's forms tutorial were evaluated on 2026-08-13. Candidate output retained identical heading counts on all five sites, identical link counts on MDN/RFC, and 1-12 additional links on Python/W3C/Wikipedia. Candidate output was 0.6-2.5% smaller. Lists remained readable while counts differed because continuation paragraphs are indented rather than misclassified as new items. Tables and preformatted code were more explicit. Snapshots and generated output are not committed.

Adversarial inputs were run in fresh processes with `/usr/bin/time -l`:

| Input                            | 1 MiB runtime / RSS | 5 MiB runtime / RSS | 5 MiB output |
| -------------------------------- | ------------------: | ------------------: | -----------: |
| Repeated malformed `<a` prefixes |  11.09 ms / 58.5 MB |  37.47 ms / 62.8 MB |          0 B |
| Escapable `*` prose              |  77.07 ms / 71.6 MB | 368.25 ms / 97.7 MB |  5,242,878 B |
| Backtick-heavy `<pre>`           |  18.28 ms / 84.5 MB | 53.88 ms / 117.8 MB |  5,242,877 B |

The minified isolated evaluation bundle containing Turndown, Domino, htmlparser2, and both renderers was 311,557 bytes (98,680 gzip). The candidate renderer with htmlparser2 was 61,293 bytes (26,922 gzip). Installed Turndown plus Domino occupied 9,028 KiB; htmlparser2 was already required by Core.

The same-commit macOS arm64 CLI executable was 87,338,978 bytes with Turndown and 87,091,298 bytes with the candidate, a 247,680-byte reduction.

Real-site HTML is temporary evaluation data and is not committed.
