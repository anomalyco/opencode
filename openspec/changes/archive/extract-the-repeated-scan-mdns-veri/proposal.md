# Proposal: Extract the repeated "scan mDNS + verify + dedup by name" pattern in packages/core/src/local-providers/ into a reusable discovery service in packages/core/src/discovery/index.ts.

## Context
No additional context provided.

## Why
This idea was submitted for autonomous implementation via the Ralph loop.

## What
Extract the repeated "scan mDNS + verify + dedup by name" pattern in packages/core/src/local-providers/ into a reusable discovery service in packages/core/src/discovery/index.ts.

## Scope
- Design and implement the core change
- Add tests covering the new behaviour
- Update documentation if the public interface changes

## Risks
- Scope creep — mitigated by breaking work into small, verifiable tasks
- Unclear requirements — mitigated by the ANALYSIS phase before coding
