# MongoDB Canonical DB Migration (2026-02-25)

Decision link: `DECISION_132`

## Problem

Runtime used canonical DB `P4NTHE0N`, but operational credential data existed in legacy DB `P4NTH30N`.

## Evidence

- Pre-migration counts:
  - `P4NTH30N.CRED3N7IAL`: total `310`, actionable `206`
  - `P4NTHE0N.CRED3N7IAL`: total `0`, actionable `0`

## Remediation

Migrated core operational collections from `P4NTH30N` to `P4NTHE0N`:

- `CRED3N7IAL`
- `J4CKP0T`
- `SIGN4L`
- `ERR0R`
- `EV3NT`
- `L0CK`
- `T35T_R3SULT`

## Verification

- Post-migration counts:
  - `P4NTH30N.CRED3N7IAL`: total `310`, actionable `206`
  - `P4NTHE0N.CRED3N7IAL`: total `310`, actionable `206`
- Runtime smoke evidence:
  - `P4NTHE0N.exe` reports `Loaded 310 credentials`

## Rule Reinforcement

When DB split-path is detected, migration to canonical DB is primary remediation; runtime auto-pivot is not the primary fix.
