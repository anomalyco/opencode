# 0001 — Verification & quality pipeline

- Status: Accepted
- Date: 2026-06-13

## Context

Two external analyses motivated this work:

1. A critique of a proposed "formal multi-agent" system prompt for opencode. Its central claim —
   that an LLM can be made to do **formal verification, Big-O analysis, and autonomous security
   auditing** as mandatory gates — is not supported by the evidence:
   - BigO(Bench) (Meta FAIR, 2025): ~**4.8%** success generating code under a complexity constraint.
   - Vericoding (2025): **26.8%–82.2%** success at verified synthesis — the number tracks the
     _tool_ (Dafny vs Lean), not model "reasoning".
   - Claude Code Security (2026): **86%** false-positive rate on the Semgrep evaluation.
     The dangerous failure mode is "confidently wrong": an LLM emits a proof/complexity claim that is
     syntactically plausible but semantically false, and nothing catches it unless a real tool runs.

2. An audit of a separate "skills" platform found systemic engineering gaps that we do **not** want
   to reproduce in opencode's own ecosystem: 0% test coverage, god modules, duplicated wrappers
   (DRY), SSRF / path-traversal, zero caching, and "LLM as a data source" (hallucinated data
   presented as fact).

## Decision

Adopt the **vericoding** posture across opencode tooling and its skill ecosystem:

> The LLM **orchestrates**; deterministic tools **verify**. Every quality "gate" is a real tool
> (`bun typecheck`, `bun test`, `oxlint`, `gitleaks`, `semgrep`, empirical benchmarks), never the
> model's own self-assessment.

Concretely:

- A **verification flow** (`script/verify.ts`, surfaced as `/verify`) runs typecheck → test → lint
  (→ optional SAST/coverage) from the affected package directory and returns **structured JSON**
  evidence. On failure it feeds the tool output back for repair. It is an **application-level**
  command: it does not touch the V2 Session core and adds **no** extra `llm.stream()` calls.
- **Enriched commit trailers** and ADRs capture tool output (coverage, lint, security, perf
  numbers come from tools, not the model).
- **Empirical profiling** (`script/bench.ts`) replaces any LLM Big-O claim with real measurements.
- A **skill authoring standard** + a deterministic **skill-vetter** guard the skill ecosystem
  against the audit's failure modes.
- **Humans decide** on anything risky (security findings, merges). Security scanning annotates;
  it never auto-blocks a merge on a model-derived "score".

### Repo conventions this work follows (from `AGENTS.md`)

- Base branch is `dev`; short hyphenated branch names; `type(scope): summary` commits.
- Tests run from package dirs (`do-not-run-tests-from-root`); `bun typecheck`, never `tsc`.
- Effect + Effect `Schema`; avoid `try`/`catch`, `any`, star/aliased imports; prefer Bun APIs and
  `Schema.UnknownFromJsonString`/`decodeUnknownOption` over raw `JSON.parse` for untrusted input.

## Consequences

- Quality signals become reproducible and auditable instead of model-dependent.
- Cost/latency stays bounded: the gate is **one** tool cycle, opt-in — not a 7-agent LLM pipeline.
- New skills carry tests + an eval set by construction, so the "0% coverage" failure cannot recur.

## Rejected alternatives

- LLM-performed formal proof / mandatory correctness proofs (Vericoding 26.8%–82.2%).
- LLM Big-O analysis and "mathematically justified" algorithm swaps (BigO(Bench) 4.8%).
- A mandatory 7-LLM-agent pipeline as gates (5–10× cost/latency; circular self-review).
- Auto-blocking merges on an LLM security score (86% false positives).
- An auto-extracted RDF/SPARQL knowledge graph (no empirical support; operational cost) — use ADRs.
- "LLM as a data source" for facts/figures (hallucination risk) — forbidden in the skill standard.
