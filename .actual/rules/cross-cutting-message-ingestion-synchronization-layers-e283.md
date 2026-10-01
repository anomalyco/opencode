# Standardize Chronological Ordering for Session Message Ingestion and Timelines: Message Ingestion Synchronization Layers Not Assume

These rules are ALWAYS ACTIVE for all session message ingestion, timeline aggregation, sync hydration reducers, transcript exports, and history revert calculations across packages/app, packages/tui, packages/opencode, and packages/web.

### Rules

- **R-MSG-001** MUST_NOT: Message ingestion and synchronization layers MUST NOT assume or depend upon network transport arrival order for message sequencing.

### Verify

```bash
# Run test suite for session synchronization, timeline aggregation, and revert calculation
npx turbo test --filter=app --filter=tui --filter=opencode --filter=web
# Run linter and type-checker across packages
npx turbo check
```

**Accept when:**
- Sync reducers and timeline views sort messages strictly by creation timestamp even when supplied out-of-order test events.
- Transcript exports and revert boundary calculations produce deterministic outputs matching creation timestamp ordering across all packages.

<enforcement>
Claude Code MUST NOT skip or defer verification.
</enforcement>