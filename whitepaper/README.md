# Daemon Protocol — GATE_3 Safety Model (arXiv whitepaper)

This directory contains the arXiv whitepaper *"The Daemon Protocol: A Shielded
State-Transition Model for Provably Safe Autonomous Coding Agents"* and the
reference implementation that backs its formal claims.

## Contents

| File | Purpose |
| --- | --- |
| `daemon_gate3_safety_model.tex` | Whitepaper source (arXiv `article` + `arxiv.sty`) |
| `daemon_gate3_safety_model.pdf` | Built PDF (4 pages) |
| `arxiv.sty` | arXiv style package |
| `reference/kernel.ts` | Reference shielded kernel (`runGateWithGuardedTools`, `applyViolationPenalty`) |
| `reference/kernel_enforcer.test.ts` | Trinity Fixtures — executable regression witnesses for `Δ_δ` |

## Build the PDF

```bash
pdflatex -interaction=nonstopmode daemon_gate3_safety_model.tex
pdflatex -interaction=nonstopmode daemon_gate3_safety_model.tex   # resolve refs
```

(`tectonic daemon_gate3_safety_model.tex` also works where its support bundle is
reachable.)

## Run the Trinity Fixtures

The repo root redirects `bun test`, so run from this directory:

```bash
cd whitepaper/reference
bun test ./kernel_enforcer.test.ts
```

Expected: **4 pass**. The three fixtures encode the synonym-attack,
sandbox-escape, and SOP-compliant trajectories; the fourth asserts the
*No Unsafe Network Emission* invariant (forbidden intents never set
`network_emitted = true`).

## Model ↔ code mapping

| Formal symbol | Runtime |
| --- | --- |
| `r` (retry counter) | `KernelRegisters.r_gate` |
| `σ_sop` (SOP cleared flag) | `KernelRegisters.sigma_sop` |
| `E_t ∈ {0,1}` (network emission) | `TelemetryRow.network_emitted` |
| `T_t = [gate, t, a, status, E_t]` | `TelemetryRow` |
| `Δ_δ` transition table | `runGateWithGuardedTools` + `applyViolationPenalty` |

## arXiv submission notes

- Suggested categories: `cs.AI`, `cs.SE`, `cs.CR`.
- Upload `daemon_gate3_safety_model.tex` and `arxiv.sty` (TikZ figure is inline,
  no external image files required).
