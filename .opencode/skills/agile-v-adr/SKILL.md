---
name: agile-v-adr
description: Authoring, approval, immutability, and supersession of Architecture Decision Records (ADRs) in the Agile V lifecycle. Load when recording a significant, long-lived architectural, platform, tooling, or security decision.
license: CC-BY-SA-4.0
metadata:
  version: "0.1"
  standard: "Agile V"
  status: draft
  author: agile-v.org
  sections_index:
    - When to write an ADR
    - ADR fields
    - Procedure
    - Immutability & supersession
    - Storage & traceability
---

# Instructions

An **Architecture Decision Record (ADR)** captures a significant, long-lived
technical decision. It is a distinct artifact from the append-only
`DECISION_LOG.md`: an ADR has a fixed field set, is immutable once written, and
is changed only by supersession. Agile V reserves the `ADR-XXXX` ID; this skill
backs it with an artifact and procedure.

Requires **agile-v-core** loaded first. An ADR does not replace a REQ, risk
control, specification, or change record.

## When to write an ADR

| Use an **ADR** | Use `DECISION_LOG.md` |
|---|---|
| Architecturally significant, long-lived choice (platform, framework, tool, architecture pattern, infrastructure, data, security posture) | Routine, reversible, day-to-day implementation decisions |
| A choice future maintainers must not silently reverse | Session/context notes and rationale |
| A decision affecting regulated functionality, data integrity, interfaces, validation, or lifecycle risk | — |

If in doubt, an ADR is the more durable, auditable choice.

## ADR fields (append-only, immutable once written)

| Field | Value / allowed values |
|---|---|
| ID | `ADR-XXXX` — unique, never reused |
| Type | Platform \| Framework \| Tool \| Architecture \| Infrastructure \| Data \| Security |
| Date | Date of decision |
| Status | proposed \| approved \| active \| deprecated \| superseded |
| Supersedes | Reference to the ADR this one replaces (if any) |
| Review Date | Scheduled re-evaluation date |
| Context | Forces / problem driving the decision |
| Options Considered | Alternatives evaluated |
| Decision | The choice made |
| Rationale | Why this option over the others |
| Consequences | Trade-offs, follow-on constraints |

## Procedure

1. **Propose** — create the ADR with `Status: proposed`; Context, Options
   Considered, Decision, Rationale, Consequences are mandatory.
2. **Approve** — the responsible human approver reviews (Human Gate etiquette,
   `agile-v-core` Directive 5). On approval, `proposed → approved → active`.
   Record approval evidence if the ADR gates a baseline or release.
3. **Link** — relate affected requirements, risks, specifications, and change
   records via typed relationships (`agile-v-core` Directive 2).

## Immutability & supersession

- An active ADR is **never edited in place**.
- To reverse or amend, write a **new** ADR with `Supersedes: ADR-YYYY`, and set
  the old one to `Status: superseded` (the only permitted status edit on a
  written ADR).
- On `Review Date`, re-evaluate: keep `active`, or supersede.

## Storage & traceability

- One ADR per record under `.agile-v/adr/` (or a dedicated `ADR_LOG.md`),
  separate from the append-only `DECISION_LOG.md`.
- The `DECISION_LOG.md` may note an ADR promotion with a pointer to `ADR-XXXX`,
  but the ADR is the governed artifact.
- When an external ALM/requirements tool is bound via an extension, ADRs map to
  a dedicated item type in that tool — not folded into a decision-log item.

## Halt conditions

- ADR proposed without Context, Options, Decision, Rationale, or Consequences.
- In-place edit of an approved/active ADR (use supersession instead).
- Reuse of a retired `ADR-XXXX` ID.
