# MoA — Mixture of Agents runner

Standalone opencode tooling: a local Mixture-of-Agents wrapper. `bin/moa-run`
fans a task prompt out to multiple advisor models in parallel (thread pool,
stdlib `urllib` only), collects their analyses, then sends them plus the
original task to an aggregator model that produces the final verdict — the
Hermes `captain-test` MOA preset, runnable from the command line via Aperture
(the captain's Ollama Cloud route).

Self-contained: no opencode core imports, no security-lab imports. The same
wrapper ships in the security-lab lane in parallel; this copy is kept in sync
manually.

## Default roles (captain-test preset)

- advisors: `ollama-cloud/glm-5.2`, `ollama-cloud/minimax-m3`
- aggregator: `ollama-cloud/deepseek-v4-flash:0731` (`reasoning_effort=max`)

## Usage

```bash
tools/moa/bin/moa-run "Is this exploit chain plausible? ..." --out verdict.json
# or from a file, with context + audit traces:
tools/moa/bin/moa-run --file task.md --context "$(cat context.md)" \
    --out verdict.json --traces traces/
# override roles:
tools/moa/bin/moa-run "analyze this" \
    --advisors ollama-cloud/glm-5.2,ollama-cloud/minimax-m3 \
    --aggregator ollama-cloud/deepseek-v4-flash:0731
```

Exit codes: `0` verdict produced, `2` usage error, `3` pipeline failure
(all advisors failed or aggregator failed). Run `tools/moa/bin/moa-run --help`
for the full option list.

## Route & keys

`MOA_BASE_URL` (default `http://ai.tail492ce8.ts.net/v1`, fallback
`OLLAMA_API_BASE`) + `MOA_API_KEY` (fallback `OLLAMA_API_KEY`; default
`not-required` — Aperture requires no client auth). Keys come from the
environment only, never from code or committed config. Config: `moa.yaml` or
`MOA_CONFIG` (`tools/moa/moa.yaml` documents every field).

## Traces & audit

- Advisor analyses + aggregator transcripts are written as JSON into `traces/`
  (default; `--traces <dir>` or `MOA_TRACES_DIR`) — one dir per run, one file
  per advisor, one for the aggregator call, plus a `run.json` manifest.
- One best-effort JSONL audit entry per run is appended to `tools/moa/audit/moa-run.jsonl` (override with `MOA_AUDIT_LOG`); audit failures never break the run.

Both are untrusted model output — never commit them.

## Library

`lib/moa.py` is the whole pipeline (`MoaConfig`, `load_config`,
`chat_completions`, `run_moa`); `chat_completions` is the single network
seam. `bin/moa-run` is a thin CLI over it.

## Setup & tests

Requires Python 3.10+ and `pyyaml` (stdlib otherwise). Tests mock
`chat_completions` — no live quota is consumed.

```bash
python3 -m venv .venv            # inside tools/moa (gitignored)
.venv/bin/pip install -r tools/moa/requirements.txt
.venv/bin/pytest tools/moa/tests
```
