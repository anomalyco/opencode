# Negative Cases: system-understanding-agent

## When should this skill NOT proceed?

| Case | Condition | Expected behavior |
|---|---|---|
| NC-001 | Change request is ambiguous (no target component, no description) | HALT. Ask for clarification before proceeding. |
| NC-002 | Graph is found but is not valid JSON | Record `GraphLoadError`. Gate 0 FAIL. Block. |
| NC-003 | Confidence is Low and no human has acknowledged | Gate 0 FAIL. Present confidence rationale. Request human approval. |
| NC-004 | No system context available at all (no graph, no README, no docs, no source) | Gate 0 FAIL. Cannot proceed without any context. |

## What this skill must NOT do

- Must NOT generate requirements. That is `requirement-architect`.
- Must NOT write implementation code.
- Must NOT modify any source files.
- Must NOT remove or overwrite existing `.agile-v/` artifacts without logging the replacement.
- Must NOT include raw secrets, credentials, or PII in any output artifact.
- Must NOT assume the graph is accurate for changes made after the last graph generation.
- Must NOT pass Gate 0 when blocking issues are unresolved.
