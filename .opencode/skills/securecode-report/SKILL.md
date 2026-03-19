---
name: securecode-report
description: Author a Japanese SecureCode benchmark report from artifacts under `benchmarks/securecode`. Use when the user asks for a final memo, a shareable writeup, graph captions, or a report that follows the SecureCode benchmark style.
---

# SecureCode Report

## Overview

Use this skill to turn an existing benchmark run into a human-facing Japanese report.

Read [../../../benchmarks/securecode/REPORT_AUTHORING_TIPS.md](../../../benchmarks/securecode/REPORT_AUTHORING_TIPS.md) first, then inspect the actual run artifacts:

- `summary.json`
- `phase_metrics.csv`
- `phase_buckets.csv`
- `charts/*.png`
- `monitoring/*` only when hardware findings are needed

## Default workflow

1. Identify the target run directory and make it canonical.
   - Prefer a run directory under `${REPO_ROOT}/results/...`.
   - If the only available run is under `/tmp` or another external directory, copy or sync it into `results/` before finalizing the report, unless the user explicitly asked to keep it elsewhere.
2. Read the benchmark artifacts and extract only measured values.
3. Write a polished Japanese memo with this structure unless the user asked for another format:
   - `1. エグゼクティブサマリ`
   - `2. 主要メトリクス表`
   - `3. マシン資源表`
   - `4. アーティファクト一覧`
   - `5. グラフ`
   - `6. 添付ファイル`
   - `7. 考察`
4. Reproduce the sample page's strengths:
   - short callout with the conclusion first
   - dense but readable Japanese prose
   - one-sentence interpretation after each table
   - four graph captions that explain the point of each image before the reader opens it
   - inline image embedding in the report itself and the final response or page, not just file listing
5. Omit `運用・販売の示唆` unless the user explicitly asks for commercial interpretation.
6. Save the memo in the canonical run directory as `securecode-capacity-ceiling-analysis-YYYYMMDD.ja.md` or another user-requested filename.
7. After saving, verify the markdown by re-reading it once and checking:
   - all four images are embedded with absolute paths
   - those paths point to files that actually exist
   - attachment links point to the canonical `results/` copy
   - the report ends with `考察`

## Guardrails

- Copy the sample page's readability, structure, section density, and image treatment, not its environment-specific values.
- Do not invent a saturation point. If the sweep did not reach one, state that clearly.
- If monitoring was not collected, mark GPU / power / temperature as `未計測`.
- Always preserve the four-image set when charts are available:
  - `capacity_overview.png`
  - `latency_boxplot.png`
  - `throughput_heatmap.png`
  - `resource_spikes.png`
- If a latency spike rate series or panel is blank, do not silently ignore it. Call it out, and if the blank state looks like a rendering bug rather than true zero data, send the work back to benchmark/chart regeneration before finalizing.
- In user-facing output, embed images inline with absolute paths when the client supports it.
- The saved markdown artifact should also embed the images inline with absolute paths when the client supports it.
- Keep graph captions short, concrete, and data-backed.
- When publishing to Notion, prefer an agent-written markdown file over auto-generated prose.
- End the report with a short `考察` section that explains what the run means, what matched the reference, and what still prevents full reproduction.
- Do not leave broken image paths that still point at `/tmp` when the canonical artifact lives under `results/`.
