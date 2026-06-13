# Architecture Decision Records (ADR)

This directory holds short, versioned records of architectural decisions, in the
[ADR](https://adr.github.io/) format. Each record is immutable once accepted; to change a
decision, add a new ADR that supersedes the old one.

Records exist so the _why_ behind a decision survives in git next to the code, instead of in
a chat log or someone's memory.

## Format

```md
# NNNN — Title

- Status: Proposed | Accepted | Superseded by ADR-XXXX
- Date: YYYY-MM-DD

## Context

What forces are at play (problem, constraints, evidence).

## Decision

What we decided to do.

## Consequences

Trade-offs, follow-ups, what becomes easier/harder.

## Rejected alternatives

What we deliberately did not do, and why.
```

Number files sequentially: `0001-title.md`, `0002-title.md`, …

## Index

- [0001 — Verification & quality pipeline](./0001-verification-and-quality-pipeline.md)
