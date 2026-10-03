# Standardize Chronological Ordering for Session Message Ingestion and Timelines: Session Message Timelines Transcript Exports Sync

These rules are ALWAYS ACTIVE for all files matching the configured scope across packages/app, packages/tui, packages/opencode, and packages/web.

### Rules

- **R-ORD-001** MUST: Session message timelines, transcript exports, and sync hydration reducers MUST order messages deterministically by persistent creation timestamp rather than array insertion sequence.
- **R-ORD-002** MUST: Incorporate a secondary deterministic tie-breaker (such as unique message ID) when creation timestamps are equal to prevent non-deterministic sorting order across clients.

### Verify

```bash
# Run the project's test suite for session synchronization, timeline aggregation, and revert calculation
npx jest --testNamePattern="session|timeline|revert|sync"
# Run repository linter and type-checker across packages
npx turbo run lint typecheck
```

**Accept when:**
- Sync reducers and timeline views sort messages strictly by creation timestamp even when supplied out-of-order test events.
- Transcript exports and revert boundary calculations produce deterministic outputs matching creation timestamp ordering across all packages.

<enforcement>
Claude Code MUST NOT skip or defer verification. Automated unit and integration test suites validating out-of-order message hydration and timeline sorting must pass successfully.
</enforcement>