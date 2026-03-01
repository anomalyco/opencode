# Pattern: Managed Stack Assimilation Loop

Decision link: `DECISION_120`

## Objective

Keep third-party toolchains under OpenFixer control with deterministic source/dev synchronization and host-level evidence.

## Loop

1. Discover stack upstream and package IDs.
2. Maintain `*-source` and `*-dev` mirrors under `OP3NF1XER/`.
3. Sync source from upstream, then fast-forward dev from source-local.
4. Enforce runtime PATH policy for canonical command surfaces before runtime audit.
5. Run inventory + duplicate detection.
6. Run development parity checks (`*-source` HEAD equals `*-dev` HEAD) for assimilated stacks.
7. Update package lock and source reference docs for new stack members.
8. Document outcomes in decision + deployment journal.

## Exit Criteria

- Sync complete.
- Duplicate state known and logged.
- Knowledgebase index and source references updated.
