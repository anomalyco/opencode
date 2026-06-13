---
name: report-builder
description: Turn a local JSON data file into a clean Markdown report. Use when the user has data on disk and wants it formatted; it never fetches or invents numbers.
---

# report-builder

Render a Markdown report from a **local** JSON file the caller provides. The file is the source of
truth — this skill never fetches from the network and never invents figures (the "LLM-as-data-source"
anti-pattern). See [`../AUTHORING.md`](../AUTHORING.md).

## Use it

```sh
bun run scripts/build-report.ts --in <data.json> --out-dir <dir> --name <report.md>
```

Input JSON shape:

```json
{ "title": "Q2 Review", "generatedFor": "Acme", "rows": [{ "label": "Revenue", "value": 1200 }] }
```

## Guarantees (enforced by code + the vetter)

- Reads only a local, caller-provided file (`assertLocalSource`) — no network, no SSRF.
- Output path cannot escape `--out-dir` (`resolveInside`) — no path traversal.
- The pure render is cached by input hash (`memoize`) — the audit's "zero cache" lesson.
- Covered by tests (`scripts/build-report.test.ts`) and an eval set (`eval/eval.json`).
