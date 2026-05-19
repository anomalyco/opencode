# Code Review Output Template

Use this **exact format** when presenting synthesized review findings. Findings are grouped by severity, not by reviewer.

**IMPORTANT:** Use pipe-delimited markdown tables (`| col | col |`). Do NOT use ASCII box-drawing characters.

## Example

```markdown
## Code Review Results

**Scope:** merge-base with the review base branch -> working tree (14 files, 342 lines)
**Intent:** Add order export endpoint with CSV and JSON format support
**Mode:** autofix

**Reviewers:** correctness, testing, maintainability, security, api-contract
- security -- new public endpoint accepts user-provided format parameter
- api-contract -- new /api/orders/export route with response schema

### P0 -- Critical

| # | File | Issue | Reviewer | Confidence | Route |
|---|------|-------|----------|------------|-------|
| 1 | `orders_controller.rb:42` | User-supplied ID in account lookup without ownership check | security | 0.92 | `gated_auto -> downstream-resolver` |

### P1 -- High

| # | File | Issue | Reviewer | Confidence | Route |
|---|------|-------|----------|------------|-------|
| 2 | `export_service.rb:87` | Loads all orders into memory -- unbounded for large accounts | performance | 0.85 | `safe_auto -> review-fixer` |
| 3 | `export_service.rb:91` | No pagination -- response size grows linearly with order count | api-contract, performance | 0.80 | `manual -> downstream-resolver` |

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence | Route |
|---|------|-------|----------|------------|-------|
| 4 | `export_service.rb:45` | Missing error handling for CSV serialization failure | correctness | 0.75 | `safe_auto -> review-fixer` |

### P3 -- Low

| # | File | Issue | Reviewer | Confidence | Route |
|---|------|-------|----------|------------|-------|
| 5 | `export_helper.rb:12` | Format detection could use early return instead of nested conditional | maintainability | 0.70 | `advisory -> human` |

### Applied Fixes

- `safe_auto`: Added bounded export pagination guard and CSV serialization failure test coverage in this run

### Residual Actionable Work

| # | File | Issue | Route | Next Step |
|---|------|-------|-------|-----------|
| 1 | `orders_controller.rb:42` | Ownership check missing on export lookup | `gated_auto -> downstream-resolver` | Create residual todo and require explicit approval before behavior change |
| 2 | `export_service.rb:91` | Pagination contract needs a broader API decision | `manual -> downstream-resolver` | Create residual todo with contract and client impact details |

### Pre-existing Issues

| # | File | Issue | Reviewer |
|---|------|-------|----------|
| 1 | `orders_controller.rb:12` | Broad rescue masking failed permission check | correctness |

### Learnings & Past Solutions

- [Known Pattern] `docs/solutions/export-pagination.md` -- previous export pagination fix applies to this endpoint

### Agent-Native Gaps

- New export endpoint has no CLI/agent equivalent -- agent users cannot trigger exports

### Schema Drift Check

- Clean: schema.rb changes match the migrations in scope

### Deployment Notes

- Pre-deploy: capture baseline row counts before enabling the export backfill
- Verify: `SELECT COUNT(*) FROM exports WHERE status IS NULL;` should stay at `0`
- Rollback: keep the old export path available until the backfill has been validated

### Coverage

- Suppressed: 2 findings below 0.60 confidence
- Residual risks: No rate limiting on export endpoint
- Testing gaps: No test for concurrent export requests

---

> **Verdict:** Ready with fixes
>
> **Reasoning:** 1 critical auth bypass must be fixed. The memory/pagination issues (P1) should be addressed for production safety.
>
> **Fix order:** P0 auth bypass -> P1 memory/pagination -> P2 error handling if straightforward
```

## Anti-patterns

Do NOT produce output like this. The following is wrong:

```markdown
Findings

Sev: P1
File: foo.go:42
Issue: Some problem description
Reviewer(s): adversarial
Confidence: 0.85
Route: advisory -> human
────────────────────────────────────────
Sev: P2
File: bar.go:99
Issue: Another problem
```

This fails because: no pipe-delimited tables, no severity-grouped `###` headers, uses box-drawing horizontal rules, no numbered findings, no `## Code Review Results` title, and the verdict is not in a blockquote. Always use the table format from the example above.

## Formatting Rules

- **Pipe-delimited markdown tables** for findings -- never ASCII box-drawing characters or per-finding horizontal-rule separators between entries (the report-level `---` before the verdict is still required)
- **Severity-grouped sections** -- `### P0 -- Critical`, `### P1 -- High`, `### P2 -- Moderate`, `### P3 -- Low`. Omit empty severity levels.
- **Always include file:line location** for code review issues
- **Reviewer column** shows which persona(s) flagged the issue. Multiple reviewers = cross-reviewer agreement.
- **Confidence column** shows the finding's confidence score
- **Route column** shows the synthesized handling decision as ``<autofix_class> -> <owner>``.
- **Header includes** scope, intent, and reviewer team with per-conditional justifications
- **Mode line** -- include `interactive`, `autofix`, `report-only`, or `headless`
- **Applied Fixes section** -- include only when a fix phase ran in this review invocation
- **Residual Actionable Work section** -- include only when unresolved actionable findings were handed off for later work
- **Pre-existing section** -- separate table, no confidence column (these are informational)
- **Learnings & Past Solutions section** -- results from learnings-researcher, with links to docs/solutions/ files
- **Agent-Native Gaps section** -- results from agent-native-reviewer. Omit if no gaps found.
- **Schema Drift Check section** -- results from schema-drift-detector. Omit if the agent did not run.
- **Deployment Notes section** -- key checklist items from deployment-verification-agent. Omit if the agent did not run.
- **Coverage section** -- suppressed count, residual risks, testing gaps, failed reviewers
- **Summary uses blockquotes** for verdict, reasoning, and fix order
- **Horizontal rule** (`---`) separates findings from verdict
- **`###` headers** for each section -- never plain text headers

## Headless Mode Format

In `mode:headless`, replace the interactive pipe-delimited table report with a structured text envelope. The headless format is defined in the `### Headless output format` section of SKILL.md. Key differences from the interactive format:

- **No pipe-delimited tables.** Findings use `[severity][autofix_class -> owner] File: <file:line> -- <title>` line format with indented Why/Evidence/Suggested fix lines.
- **Findings grouped by autofix_class** (gated-auto, manual, advisory) instead of severity. Within each group, findings are sorted by severity.
- **Verdict in header** (top of output) instead of bottom, so programmatic callers get it first.
- **`Artifact:` line** in metadata header gives callers the path to the full run artifact.
- **`[needs-verification]` marker** on findings where `requires_verification: true`.
- **Evidence lines** included per finding.
- **Completion signal:** "Review complete" as the final line.
