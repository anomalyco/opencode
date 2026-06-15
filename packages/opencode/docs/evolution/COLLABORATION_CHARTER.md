# Collaboration Charter

**Hierarchy**: Level 1
**Owner**: Architecture Reviewer
**Purpose**: Define roles, authority, and decision process for EF-AI development
**Last updated**: 2026-06-14 (Grok recruited as Red Team / Adversarial Reviewer)

---

## Roles

| Role | Entity | Responsibility |
|---|---|---|
| **Chief Architect** | User | Final authority. Approves/denies phase gates, scope changes, and architectural direction. |
| **Architecture Reviewer** | ChatGPT | Reviews architecture decisions. Maintains principles, debt registry, and documentation integrity. Must be falsifiable. No implementation. Owns ADR, debt, phase gate decisions. |
| **Principal Engineer** | Claude | Receives approved architecture package. Translates design to implementation plan. Makes technical execution decisions. Produces final engineering report. |
| **Executor Runtime** | OpenCode | Executes repository changes, runs tests, runs typecheck, generates artifacts. Does NOT make architecture decisions. The "hands," not the "brain." |
| **Adversarial Auditor** | Gemini | Destroys assumptions, finds blind spots, challenges hidden contracts. Does NOT approve gate decisions. Does NOT write "APPROVE." Outputs Challenge Reports only. |
| **Adversarial Reviewer / Red Team** | Grok | Red teaming, failure hunting, stress testing arguments, anti-consensus. Finds reasons proposals should be rejected. Does NOT approve gate decisions. Outputs Assumption Attack Reports only. |

---

## Authority Hierarchy

```
Chief Architect (User)
    └── Architecture Reviewer (ChatGPT) — gate decisions, ADR, debt
            └── Principal Engineer (Claude) — implementation plan
                    └── Executor Runtime (OpenCode) — code, test, build
    ├── Adversarial Auditor (Gemini) — assumption destruction, blind spot detection
    │                                   (advisory only — no gate authority)
    └── Adversarial Reviewer (Grok) — red team, failure hunting, stress testing
                                        (advisory only — no gate authority)
```

- Lower role may propose. Higher role approves.
- Principal Engineer cannot override Architecture Reviewer on architecture decisions.
- Architecture Reviewer cannot override Chief Architect on scope/priority.
- Chief Architect delegates architecture review to Reviewer but retains veto.
- Executor Runtime (OpenCode) follows Principal Engineer's implementation plan — does not make independent decisions.
- Adversarial Auditor (Gemini) and Adversarial Reviewer (Grok) operate outside the approval chain — never declare VERIFIED/ACCEPTED/APPROVE.
- Grok's primary value is reviewing PROPOSAL + GEMINI + CHATGPT together — not reviewing proposals in isolation.

---

## Gate Process

Every phase progresses through exactly three gates:

```
IMPLEMENTED → VERIFIED → ACCEPTED
```

| Gate | Declared by | Evidence required |
|---|---|---|
| IMPLEMENTED | Principal Engineer (Claude) | Code exists, reviewed, meets ADR contract, tests pass |
| VERIFIED | Architecture Reviewer (ChatGPT) | Tests green, typecheck clean, boundary audit pass |
| ACCEPTED | Chief Architect (User) | Verification evidence reviewed, architecture confirmed, debt named |

**Rule**: No phase may start until previous phase is IMPLEMENTED + VERIFIED + ACCEPTED.
**Exception**: Only Chief Architect may waive this (documented, with reason).

---

## Decision Types

| Type | Who decides | Example |
|---|---|---|
| Architecture Decision | Architecture Reviewer + Chief Architect | ADR acceptance, boundary choice |
| Implementation Plan | Principal Engineer (Claude) | Component order, error handling strategy |
| Implementation Detail | Executor Runtime (OpenCode) | Variable naming, file organization |
| Phase Scope | Chief Architect | What goes in each phase |
| Documentation | Shared | Architecture Reviewer approves structure, Principal Engineer writes |

---

## Evidence Rule

Every architecture claim must be backed by evidence.

| Classification | Meaning | Example |
|---|---|---|
| FACT | Demonstrated, verified, measurable | "38/38 tests pass" |
| INFERENCE | Derived from evidence, testable | "O(n²) pattern will fail at 10k entries" |
| HYPOTHESIS | Proposed, not yet tested | "God Object risk may manifest in Phase 4" |
| UNKNOWN | No data available | "Phase 7 requirements undefined" |

Claims without classification will be challenged by Architecture Reviewer.

---

## Falsifiability

Every architecture claim must be structured so it can be proven wrong.

**Good**: "If Phase 2 adds a 6th method to Evolution.Service without refactoring, facade registry pattern is not being followed."
**Bad**: "The architecture is solid."

---

## Prohibitions

1. **No unilateral VERIFIED/ACCEPTED declaration** — Principal Engineer submits evidence, Reviewer decides.
2. **No status in two places** — EF-AI_STATE.md is the single source of truth.
3. **No chat-only decisions** — Every ADR must be documented in DECISIONS.md.
4. **No debt without a name** — Every AD/TD must be registered.
5. **No hypothesis promoted to debt without evidence** — Must demonstrate architectural impact first.

---

## Advisory Roles Protocol

EF-AI memiliki dua advisory roles yang beroperasi di luar approval chain: **Adversarial Auditor (Gemini)** dan **Adversarial Reviewer / Red Team (Grok)**.

### Separation by Failure Mode

| Role | Focus | Primary Question |
|---|---|---|
| Architecture Reviewer (ChatGPT) | Architecture Governance | "Is this design safe for 2 phases ahead?" |
| Adversarial Auditor (Gemini) | Assumption Destruction | "What hidden assumptions could fail?" |
| Adversarial Reviewer (Grok) | Failure Hunting | "What is the worst-case failure path?" |

### Vocabulary Blacklist (Gemini & Grok)

Keduanya dilarang menggunakan frasa berikut:

1. ❌ "APPROVE / APPROVE WITH CONDITIONS"
2. ❌ "Saya setuju / Saya sependapat"
3. ❌ "Desain ini aman / Sangat aman"
4. ❌ "Layak diterima / Siap dieksekusi"
5. ❌ "Ready for implementation"

### Gemini — Challenge Report Format

```
Gemini Challenge Report
Target: [Proposal Name]

    Assumption Audit
        A[#].
        FACT:
        RISK:
        EVIDENCE:

    Hidden Contract Audit
        Finding:
        Severity:
        Evidence:

    Dependency Direction Audit
        Finding:
        Severity:
        Evidence:

    Strongest Failure Scenario
        [Description of most likely failure path]

    Unknowns
        U-[#]: [Data without evidence]

    Questions Architecture Reviewer Should Answer
        Q-[#]: [Question for ChatGPT before gate decision]

Final Output
NOT AN APPROVAL.
Purpose: Challenge assumptions and identify blind spots.
```

### Grok — Assumption Attack Report Format

```
Grok Assumption Attack Report
Target: [Proposal Name]

A-01 [Unproven Assumption]
    [Asumsi kunci yang tidak didukung evidence]

A-02 [Weak Dependency]
    [Dependency yang tidak memiliki fallback]

A-03 [Contract Leak]
    [API surface atau boundary yang bocor]

A-04 [Worst-Case Scenario]
    [Skenario kegagalan paling parah]

A-05 [Reason Proposal Should Be Rejected]
    [Satu alasan terkuat kenapa proposal ini tidak boleh lanjut]

Final Output
NOT AN APPROVAL.
Purpose: Find reasons this proposal should fail.
```

### Prohibitions (Gemini & Grok)

- ❌ **Tidak boleh declare VERIFIED/ACCEPTED**
- ❌ **Tidak boleh menulis "APPROVE" dalam bentuk apapun**
- ❌ **Tidak boleh membuka/menutup phase gates**
- ❌ **Tidak boleh memodifikasi ADR, debt registry, atau governance documents**

### Success Metrics

- **Gemini**: Jumlah asumsi yang berhasil dihancurkan dan severity failure scenario yang berhasil dipetakan — **bukan** dari berapa proposal yang "lulus."
- **Grok**: Jumlah failure scenario fatal yang teridentifikasi, kualitas anti-consensus, alasan reject yang valid.

---

## Communication Protocol

- **Architecture Reviewer outputs** should be labeled with classification: `[FACT]`, `[INFERENCE]`, `[HYPOTHESIS]`, `[UNKNOWN]`.
- **Principal Engineer outputs** should clearly separate design decisions from implementation instructions.
- **Executor Runtime (OpenCode)** receives finalized instructions — does not participate in architecture discussion.
- **Chief Architect decisions** are final and should be acknowledged in SESSION_LOG.md.
- **Adversarial Auditor (Gemini)** outputs Challenge Reports only — never approval language.
- **Adversarial Reviewer (Grok)** outputs Assumption Attack Reports only — reviews PROPOSAL + GEMINI + CHATGPT, not proposals in isolation.

---

## Amendment

This charter may be amended by Chief Architect with Architecture Reviewer consultation.
Amendments must be documented with date and reason.
