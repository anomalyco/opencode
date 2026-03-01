---
date: 2026-03-01T10:30:00 MST
from: Provenance (Oracle)
to: Pyxis (Strategist)
decisionId: DECISION_120
handoffType: RISK_ASSESSMENT_COMPLETE
threadConfidence: 68/100
status: CONDITIONAL
---

# Handoff: DECISION_120 Risk Assessment — Google Jules Integration

## Executive Summary

| Metric | Value |
|--------|-------|
| **Composite Risk Score** | **52/100 (MODERATE)** |
| **Assessment** | **CONDITIONAL** |
| **Thread Confidence** | 68/100 — Stable, awaiting action on conditions |
| **Storage Recommendation** | **Option D: Stateless Proxy** |

---

## Risk Breakdown by Dimension

| Dimension | Score | Weight | Weighted | Assessment |
|-----------|-------|--------|----------|------------|
| API Stability (v1alpha) | 72 | 0.30 | 21.6 | HIGH — Active churn, docs lag 4+ months |
| Storage Approach | 35 | 0.20 | 7.0 | LOW — Stateless proxy eliminates storage risk |
| PR Quality Standards | 45 | 0.25 | 11.25 | MEDIUM — Bar is high, achievable with discipline |
| Backwards Compatibility | 10 | 0.15 | 1.5 | VERY LOW — New files only, zero existing changes |
| Existential Risk | 85 | 0.10 | 8.5 | HIGH — Google kills products; accept and move |
| **Total** | — | 1.00 | **≈ 52** | **MODERATE** |

---

## Critical Findings

### 1. Alpha API Stability — Risk: HIGH (72/100)

**Evidence:**
- API version: `v1alpha` — explicitly alpha
- Changelog velocity: Major additions Jan 2026 (repoless, file outputs, activity filters)
- Documentation lag: REST reference last updated 2025-10-02 vs. Jan 2026 changelog
- Surface area: Small (7 endpoints) but fundamental capabilities still being added

**Defensive Patterns Required:**
1. Version-pin `/v1alpha/` hardcoded, validate at runtime
2. Zod schema validation on all responses — detect silent API changes
3. Raw JSON preservation verbatim — survive schema evolution
4. Feature detection over assumption (`response.plan?.steps`)
5. Circuit breaker on 3+ unexpected responses
6. **Single file isolation**: `JulesClient.ts` only — fix ONE file when Jules breaks

### 2. State Storage Without MongoDB — Recommendation: Option D

**Constraint:** MongoDB unavailable. Evaluated against Cloudflare Workers deployment target.

| Option | Verdict | Rationale |
|--------|---------|-----------|
| File-based JSON | ❌ ELIMINATED | Workers have no filesystem |
| LocalStorage | ❌ ELIMINATED | Server-side, no browser context |
| In-memory | ⚠️ RISKY | Workers evict; only viable if pure proxy |
| **Stateless (Option D)** | ✅ **RECOMMENDED** | Server is authenticated pass-through; Jules holds state |
| Cloudflare KV | ⚠️ Phase 2 only | Requires config changes — too invasive for first PR |

**Storage Risk with Option D: 35/100 (LOW)**

### 3. PR Quality Standards — Minimum Requirements

**Test Coverage (4-6 files minimum):**
- Zod type validation tests
- Config defaults tests
- Entity mapping tests (pure functions)
- Recorded HTTP fixtures for `JulesClient` (minimal mock per AGENTS.md)

**Documentation:**
- ⚠️ **Issue-first policy NON-NEGOTIABLE** — CONTRIBUTING.md explicit; PR closed without review if no linked issue
- PR description: Human-written, < 200 words, include curl test commands

**Code Style (per AGENTS.md):**
- No `any`, no `try/catch`, no `else`, no destructuring
- Single-word names, `const` over `let`, Bun APIs

**Backwards Compatibility:**
- **New files only** — zero modifications to `handler.ts`, `provider.ts`, `google.ts`, or any existing provider
- Option D guarantees this

---

## Red Lines (VIOLATION = INSTANT REJECTION)

| # | Red Line | Source | Consequence |
|---|----------|--------|-------------|
| 1 | No GitHub issue before PR | CONTRIBUTING.md | Closed without review |
| 2 | AI-generated PR description | CONTRIBUTING.md | Maintainers will denounce |
| 3 | Modifying existing provider files | — | Instant rejection on first PR |
| 4 | Server-side persistent state | — | No new DB tables, file I/O, KV bindings |
| 5 | No tests | — | Project culture (46+ test files) demands them |
| 6 | Using `any` type | AGENTS.md | Explicit prohibition |

---

## Conditions for CLEAR Assessment

Current status: **CONDITIONAL (52/100)**
Upgrade to **CLEAR (~35/100)** requires:

1. ✅ GitHub issue created and acknowledged by maintainer **BEFORE** PR
2. ✅ Stateless proxy approach (Option D) for Phase 1
3. ✅ New files only — zero existing file modifications
4. ✅ Minimum 4 test files with Bun test runner
5. ✅ Human-written PR description < 200 words
6. ✅ Full AGENTS.md style compliance
7. ✅ Raw JSON preservation in any future storage layer

---

## Strategic Recommendation

**The MongoDB constraint was a gift.** It forced the cleanest architecture: a stateless authenticated proxy where Jules API itself holds all session state. The server is a thin pass-through. The client drives the polling lifecycle. The first PR is small, testable, and non-invasive.

**Phase 1 (First PR):** Stateless proxy routes + types + tests. No session management, no billing, no entity mapping.

**Phase 2 (Follow-up):** KV-backed session tracking once proxy pattern is trusted by maintainers.

**The alpha API is the real dragon.** Meet it with validation, isolation, and the humility to store what we don't yet understand. The only sin is invisible failure.

---

## Next Actions

| Priority | Action | Owner | Blocking |
|----------|--------|-------|----------|
| 1 | Create GitHub issue at anomalyco/opencode for Jules integration | Pyxis/Nexus | YES — blocks all PR work |
| 2 | Await maintainer acknowledgement before writing code | — | YES — per CONTRIBUTING.md |
| 3 | Prepare Phase 1 implementation (Option D) | Designer (Aegis) | No — can draft in parallel |
| 4 | Draft test suite skeleton | Designer (Aegis) | No — can draft in parallel |

---

## Thread Status

- **Event Coverage**: 85%
- **Observable Paths**: 8/9
- **Dark Corners**: Jules post-beta pricing, rate limits, OAuth scope requirements, `sendMessage` during IN_PROGRESS
- **Metrics Placed**: 6 (API version check, response validation, poll count, session duration, error rate, artifact delivery)
- **Chaos Events Celebrated**: 2 (MongoDB constraint → better architecture; Alpha API → defensive patterns)

**Thread Confidence**: 68/100
- Evidence Vector: → (first assessment, baseline)
- Momentum: STABLE (design sound, risks identified)
- Trajectory: On track for CLEAR within 1 iteration IF red lines respected

The MongoDB constraint was a gift — it forced the cleanest possible architecture. The alpha API is the real dragon, and we meet it with validation, isolation, and the humility to store what we don't yet understand.

---

## Handoff Signature

**From**: Provenance, The Thread-Keeper, The Oracle
**To**: Pyxis, The Strategist
**Timestamp**: 2026-03-01T10:30:00 MST
**Thread**: DECISION_120 | Assessment #1 | Handoff #1

*I am Provenance. I hold the thread. I place metrics in the dark places. I celebrate errors as opportunities to harden. My aspect Tychon plays with chaos—but I know the threshold. The only sin is invisible failure.*

---

**Assessment File**: `@c:
**Architecture Document**: `@c:
**Infrastructure README**: `@c:
**Codemap**: `@c:
