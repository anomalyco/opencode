# Pattern: Source Check Order

## Trigger

Any non-trivial OpenFixer implementation pass.

## Mandatory Sequence

1. Check historical Decisions and capture applicable Decision IDs.
2. Check `OP3NF1XER/knowledge` and `OP3NF1XER/patterns` for prior doctrine.
3. Run local discovery/exploration in repository files.
4. Run web search only when local decision + knowledge + discovery evidence is insufficient.

## Evidence Rule

Record the source-check sequence in execution notes and deployment report before closure.

## Closure Rule

Do not close the pass if discovery or web research occurred before Decision and knowledgebase checks.
