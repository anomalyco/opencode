# Test Architect Workflow: Requirements Traceability & Quality Gate Decision

**Workflow:** `testarch-trace`
**Purpose:** Generate requirements-to-tests traceability matrix, analyze coverage gaps, and make quality gate decisions (PASS/CONCERNS/FAIL/WAIVED)
**Agent:** Test Architect (TEA)
**Format:** Pure Markdown v4.0 (no XML blocks)

---

## Overview

This workflow operates in two sequential phases to validate test coverage and deployment readiness:

**PHASE 1 - REQUIREMENTS TRACEABILITY:** Create comprehensive traceability matrix mapping acceptance criteria to implemented tests, identify coverage gaps, and provide actionable recommendations.

**PHASE 2 - QUALITY GATE DECISION:** Use traceability results combined with test execution evidence to make gate decisions (PASS/CONCERNS/FAIL/WAIVED) that determine deployment readiness.

**Key Capabilities:**

- Map acceptance criteria to specific test cases across all levels (E2E, API, Component, Unit)
- Classify coverage status (FULL, PARTIAL, NONE, UNIT-ONLY, INTEGRATION-ONLY)
- Prioritize gaps by risk level (P0/P1/P2/P3) using test-priorities framework
- Apply deterministic decision rules based on coverage and test execution results
- Generate gate decisions with evidence and rationale
- Support waivers for business-approved exceptions
- Update workflow status and notify stakeholders

---

## Prerequisites

**Required (Phase 1):**

- Acceptance criteria (from story file OR provided inline)
- Implemented test suite (or acknowledge gaps to be addressed)

**Required (Phase 2 - if `enable_gate_decision: true`):**

- Test execution results (CI/CD test reports, pass/fail rates)
- Test design with risk priorities (P0/P1/P2/P3)

**Recommended:**

- `test-design.md` (for risk assessment and priority context)
- `nfr-assessment.md` (for release-level gates)
- `tech-spec.md` (for technical implementation context)
- Test framework configuration (playwright.config.ts, jest.config.js, etc.)

**Halt Conditions:**

- If story lacks any implemented tests AND no gaps are acknowledged, recommend running `*atdd` workflow first
- If acceptance criteria are completely missing, halt and request them
- If Phase 2 enabled but test execution results missing, warn and skip gate decision

Note: `*trace` never runs `*atdd` automatically; it only recommends running it when tests are missing.

---

## PHASE 1: REQUIREMENTS TRACEABILITY

This phase focuses on mapping requirements to tests, analyzing coverage, and identifying gaps.

---

### Step 1: Load Context and Knowledge Base

**Actions:**

1. Load relevant knowledge fragments from `{project-root}/_bmad/bmm/testarch/tea-index.csv`:
   - `test-priorities-matrix.md` - P0/P1/P2/P3 risk framework with automated priority calculation, risk-based mapping, tagging strategy (389 lines, 2 examples)
   - `risk-governance.md` - Risk-based testing approach: 6 categories (TECH, SEC, PERF, DATA, BUS, OPS), automated scoring, gate decision engine, coverage traceability (625 lines, 4 examples)
   - `probability-impact.md` - Risk scoring methodology: probability × impact matrix, automated classification, dynamic re-assessment, gate integration (604 lines, 4 examples)
   - `test-quality.md` - Definition of Done for tests: deterministic, isolated with cleanup, explicit assertions, length/time limits (658 lines, 5 examples)
   - `selective-testing.md` - Duplicate coverage patterns: tag-based, spec filters, diff-based selection, promotion rules (727 lines, 4 examples)

2. Read story file (if provided):
   - Extract acceptance criteria
   - Identify story ID (e.g., 1.3)
   - Note any existing test design or priority information

3. Read related BMad artifacts (if available):
   - `test-design.md` - Risk assessment and test priorities
   - `tech-spec.md` - Technical implementation details
   - `PRD.md` - Product requirements context

**Output:** Complete understanding of requirements, priorities, and existing context

---

### Step 2: Discover and Catalog Tests

**Actions:**

1. Auto-discover test files related to the story:
   - Search for test IDs (e.g., `1.3-E2E-001`, `1.3-UNIT-005`)
   - Search for describe blocks mentioning feature name
   - Search for file paths matching feature directory
   - Use `glob` to find test files in `{test_dir}`

2. Categorize tests by level:
   - **E2E Tests**: Full user journeys through UI
   - **API Tests**: HTTP contract and integration tests
   - **Component Tests**: UI component behavior in isolation
   - **Unit Tests**: Business logic and pure functions

3. Extract test metadata:
   - Test ID (if present)
   - Describe/context blocks
   - It blocks (individual test cases)
   - Given-When-Then structure (if BDD)
   - Assertions used
   - Priority markers (P0/P1/P2/P3)

**Output:** Complete catalog of all tests for this feature

---

### Step 3: Map Criteria to Tests

**Actions:**

1. For each acceptance criterion:
   - Search for explicit references (test IDs, describe blocks mentioning criterion)
   - Map to specific test files and it blocks
   - Use Given-When-Then narrative to verify alignment
   - Document test level (E2E, API, Component, Unit)

2. Build traceability matrix:

   ```
   | Criterion ID | Description | Test ID     | Test File        | Test Level | Coverage Status |
   | ------------ | ----------- | ----------- | ---------------- | ---------- | --------------- |
   | AC-1         | User can... | 1.3-E2E-001 | e2e/auth.spec.ts | E2E        | FULL            |
   ```

3. Classify coverage status for each criterion:
   - **FULL**: All scenarios validated at appropriate level(s)
   - **PARTIAL**: Some coverage but missing edge cases or levels
   - **NONE**: No test coverage at any level
   - **UNIT-ONLY**: Only unit tests (missing integration/E2E validation)
   - **INTEGRATION-ONLY**: Only API/Component tests (missing unit confidence)

4. Check for duplicate coverage:
   - Same behavior tested at multiple levels unnecessarily
   - Flag violations of selective testing principles
   - Recommend consolidation where appropriate

**Output:** Complete traceability matrix with coverage classifications

---

### Step 4: Analyze Gaps and Prioritize

**Actions:**

1. Identify coverage gaps:
   - List criteria with NONE, PARTIAL, UNIT-ONLY, or INTEGRATION-ONLY status
   - Assign severity based on test-priorities framework:
     - **CRITICAL**: P0 criteria without FULL coverage (blocks release)
     - **HIGH**: P1 criteria without FULL coverage (PR blocker)
     - **MEDIUM**: P2 criteria without FULL coverage (nightly test gap)
     - **LOW**: P3 criteria without FULL coverage (acceptable gap)

2. Recommend specific tests to add:
   - Suggest test level (E2E, API, Component, Unit)
   - Provide test description (Given-When-Then)
   - Recommend test ID (e.g., `1.3-E2E-004`)
   - Explain why this test is needed

3. Calculate coverage metrics:
   - Overall coverage percentage (criteria with FULL coverage / total criteria)
   - P0 coverage percentage (critical paths)
   - P1 coverage percentage (high priority)
   - Coverage by level (E2E%, API%, Component%, Unit%)

4. Check against quality gates:
   - P0 coverage >= 100% (required)
   - P1 coverage >= 90% (recommended)
   - Overall coverage >= 80% (recommended)

**Output:** Prioritized gap analysis with actionable recommendations and coverage metrics

---

### Step 5: Verify Test Quality

**Actions:**

1. For each mapped test, verify:
   - Explicit assertions are present (not hidden in helpers)
   - Test follows Given-When-Then structure
   - No hard waits or sleeps
   - Self-cleaning (test cleans up its data)
   - File size < 300 lines
   - Test duration < 90 seconds

2. Flag quality issues:
   - **BLOCKER**: Missing assertions, hard waits, flaky patterns
   - **WARNING**: Large files, slow tests, unclear structure
   - **INFO**: Style inconsistencies, missing documentation

3. Reference knowledge fragments:
   - `test-quality.md` for Definition of Done
   - `fixture-architecture.md` for self-cleaning patterns
   - `network-first.md` for Playwright best practices
   - `data-factories.md` for test data patterns

**Output:** Quality assessment for each test with improvement recommendations

---

### Step 6: Generate Deliverables (Phase 1)

**Actions:**

1. Create traceability matrix markdown file:
   - Use template from `trace-template.md`
   - Include full mapping table
   - Add coverage status section
   - Add gap analysis section
   - Add quality assessment section
   - Add recommendations section
   - Save to `{output_folder}/traceability-matrix.md`

2. Generate gate YAML snippet (if enabled):

   ```yaml
   traceability:
     story_id: '1.3'
     coverage:
       overall: 85%
       p0: 100%
       p1: 90%
       p2: 75%
     gaps:
       critical: 0
       high: 1
       medium: 2
     status: 'PASS' # or "FAIL" if P0 < 100%
   ```

3. Create coverage badge/metric (if enabled):
   - Generate badge markdown: `![Coverage](https://img.shields.io/badge/coverage-85%25-green)`
   - Export metrics to JSON for CI/CD integration

4. Update story file (if enabled):
   - Add "Traceability" section to story markdown
   - Link to traceability matrix
   - Include coverage summary
   - Add gate status

**Output:** Complete Phase 1 traceability deliverables

**Next:** If `enable_gate_decision: true`, proceed to Phase 2. Otherwise, workflow complete.

---

## PHASE 2: QUALITY GATE DECISION

This phase uses traceability results to make a quality gate decision (PASS/CONCERNS/FAIL/WAIVED) based on evidence and decision rules.

**When Phase 2 Runs:** Automatically after Phase 1 if `enable_gate_decision: true` (default: true)

**Skip Conditions:** If test execution results (`test_results`) not provided, warn and skip Phase 2.

---

### Step 7: Gather Quality Evidence

**Actions:**

1. **Load Phase 1 traceability results** (inherited context):
   - Coverage metrics (P0/P1/overall percentages)
   - Gap analysis (missing/partial tests)
   - Quality concerns (test quality flags)
   - Traceability matrix

2. **Load test execution results** (if `test_results` provided):
   - Read CI/CD test reports (JUnit XML, TAP, JSON)
   - Extract pass/fail counts by priority
   - Calculate pass rates:
     - **P0 pass rate**: `(P0 passed / P0 total) * 100`
     - **P1 pass rate**: `(P1 passed / P1 total) * 100`
     - **Overall pass rate**: `(All passed / All total) * 100`
   - Identify failing tests and map to criteria

3. **Load NFR assessment** (if `nfr_file` provided):
   - Read `nfr-assessment.md` or similar
   - Check critical NFR status (performance, security, scalability)
   - Flag any critical NFR failures

4. **Load supporting artifacts**:
   - `test-design.md` → Risk priorities, DoD checklist
   - `story-*.md` or `Epics.md` → Requirements context
   - `bmm-workflow-status.md` → Workflow completion status (if `check_all_workflows_complete: true`)

5. **Validate evidence freshness** (if `validate_evidence_freshness: true`):
   - Check timestamps of test-design, traceability, NFR assessments
   - Warn if artifacts are >7 days old

6. **Check prerequisite workflows** (if `check_all_workflows_complete: true`):
   - Verify test-design workflow complete
   - Verify trace workflow complete (Phase 1)
   - Verify nfr-assess workflow complete (if release-level gate)

**Output:** Consolidated evidence bundle with all quality signals

---

### Step 8: Apply Decision Rules

**If `decision_mode: "deterministic"`** (rule-based - default):

**Decision rules** (based on `workflow.yaml` thresholds):

1. **PASS** if ALL of the following are true:
   - P0 coverage ≥ `min_p0_coverage` (default: 100%)
   - P1 coverage ≥ `min_p1_coverage` (default: 90%)
   - Overall coverage ≥ `min_overall_coverage` (default: 80%)
   - P0 test pass rate = `min_p0_pass_rate` (default: 100%)
   - P1 test pass rate ≥ `min_p1_pass_rate` (default: 95%)
   - Overall test pass rate ≥ `min_overall_pass_rate` (default: 90%)
   - Critical NFRs passed (if `nfr_file` provided)
   - No unresolved security issues ≤ `max_security_issues` (default: 0)
   - No test quality red flags (hard waits, no assertions)

2. **CONCERNS** if ANY of the following are true:
   - P1 coverage 80-89% (below threshold but not critical)
   - P1 test pass rate 90-94% (below threshold but not critical)
   - Overall pass rate 85-89%
   - P2 coverage <50% (informational)
   - Some non-critical NFRs failing
   - Minor test quality concerns (large test files, inferred mappings)
   - **Note**: CONCERNS does NOT block deployment but requires acknowledgment

3. **FAIL** if ANY of the following are true:
   - P0 coverage <100% (missing critical tests)
   - P0 test pass rate <100% (failing critical tests)
   - P1 coverage <80% (significant gap)
   - P1 test pass rate <90% (significant failures)
   - Overall coverage <80%
   - Overall pass rate <85%
   - Critical NFRs failing (`max_critical_nfrs_fail` exceeded)
   - Unresolved security issues (`max_security_issues` exceeded)
   - Major test quality issues (tests with no assertions, pervasive hard waits)

4. **WAIVED** (only if `allow_waivers: true`):
   - Decision would be FAIL based on rules above
   - Business stakeholder has approved waiver
   - Waiver documented with:
     - Justification (time constraint, known limitation, acceptable risk)
     - Approver name and date
     - Mitigation plan (follow-up stories, manual testing)
   - Waiver evidence linked (email, Slack thread, ticket)

**Risk tolerance adjustments:**

- If `allow_p2_failures: true` → P2 test failures do NOT affect gate decision
- If `allow_p3_failures: true` → P3 test failures do NOT affect gate decision
- If `escalate_p1_failures: true` → P1 failures require explicit manager/lead approval

**If `decision_mode: "manual"`:**

- Present evidence summary to team
- Recommend decision based on rules above
- Team makes final call in meeting/chat
- Document decision with approver names

**Output:** Gate decision (PASS/CONCERNS/FAIL/WAIVED) with rule-based rationale

---

### Step 9: Document Decision and Evidence

**Actions:**

1. **Create gate decision document**:
   - Save to `gate_output_file` (default: `{output_folder}/gate-decision-{gate_type}-{story_id}.md`)
   - Use structure below

2. **Document structure**:

```markdown
# Quality Gate Decision: {gate_type} {story_id/epic_num/release_version}

**Decision**: [PASS / CONCERNS / FAIL / WAIVED]
**Date**: {date}
**Decider**: {decision_mode} (deterministic | manual)
**Evidence Date**: {test_results_date}

---

## Summary

[1-2 sentence summary of decision and key factors]

---

## Decision Criteria

| Criterion         | Threshold | Actual   | Status  |
| ----------------- | --------- | -------- | ------- |
| P0 Coverage       | ≥100%     | 100%     | ✅ PASS |
| P1 Coverage       | ≥90%      | 88%      | ⚠️ FAIL |
| Overall Coverage  | ≥80%      | 92%      | ✅ PASS |
| P0 Pass Rate      | 100%      | 100%     | ✅ PASS |
| P1 Pass Rate      | ≥95%      | 98%      | ✅ PASS |
| Overall Pass Rate | ≥90%      | 96%      | ✅ PASS |
| Critical NFRs     | All Pass  | All Pass | ✅ PASS |
| Security Issues   | 0         | 0        | ✅ PASS |

**Overall Status**: 7/8 criteria met → Decision: **CONCERNS**

---

## Evidence Summary

### Test Coverage (from Phase 1 Traceability)

- **P0 Coverage**: 100% (5/5 criteria fully covered)
- **P1 Coverage**: 88% (7/8 criteria fully covered)
- **Overall Coverage**: 92% (12/13 criteria covered)
- **Gap**: AC-5 (P1) missing E2E test

### Test Execution Results

- **P0 Pass Rate**: 100% (12/12 tests passed)
- **P1 Pass Rate**: 98% (45/46 tests passed)
- **Overall Pass Rate**: 96% (67/70 tests passed)
- **Failures**: 3 P2 tests (non-blocking)

### Non-Functional Requirements

- Performance: ✅ PASS (response time <500ms)
- Security: ✅ PASS (no vulnerabilities)
- Scalability: ✅ PASS (handles 10K users)

### Test Quality

- All tests have explicit assertions ✅
- No hard waits detected ✅
- Test files <300 lines ✅
- Test IDs follow convention ✅

---

## Decision Rationale

**Why CONCERNS (not PASS)**:

- P1 coverage at 88% is below 90% threshold
- AC-5 (P1 priority) missing E2E test for error handling scenario
- This is a known gap from test-design phase

**Why CONCERNS (not FAIL)**:

- P0 coverage is 100% (critical paths validated)
- Overall coverage is 92% (above 80% threshold)
- Test pass rate is excellent (96% overall)
- Gap is isolated to one P1 criterion (not systemic)

**Recommendation**:

- Acknowledge gap and proceed with deployment
- Add missing AC-5 E2E test in next sprint
- Create follow-up story: "Add E2E test for AC-5 error handling"

---

## Next Steps

- [ ] Create follow-up story for AC-5 E2E test
- [ ] Deploy to staging environment
- [ ] Monitor production for edge cases related to AC-5
- [ ] Update traceability matrix after follow-up test added

---

## References

- Traceability Matrix: `_bmad/output/traceability-matrix.md`
- Test Design: `_bmad/output/test-design-epic-2.md`
- Test Results: `ci-artifacts/test-report-2025-01-15.xml`
- NFR Assessment: `_bmad/output/nfr-assessment-release-1.2.md`
```

3. **Include evidence links** (if `require_evidence: true`):
   - Link to traceability matrix
   - Link to test execution reports (CI artifacts)
   - Link to NFR assessment
   - Link to test-design document
   - Link to relevant PRs, commits, deployments

4. **Waiver documentation** (if decision is WAIVED):
   - Approver name and role (e.g., "Jane Doe, Engineering Manager")
   - Approval date and method (e.g., "2025-01-15, Slack thread")
   - Justification (e.g., "Time-boxed MVP, missing tests will be added in v1.1")
   - Mitigation plan (e.g., "Manual testing by QA, follow-up stories created")
   - Evidence link (e.g., "Slack: #engineering 2025-01-15 3:42pm")

**Output:** Complete gate decision document with evidence and rationale

---

### Step 10: Update Status Tracking and Notify

**Actions:**

1. **Update workflow status** (if `append_to_history: true`):
   - Append gate decision to `bmm-workflow-status.md` under "Gate History" section
   - Format:

     ```markdown
     ## Gate History

     ### Story 1.3 - User Login (2025-01-15)

     - **Decision**: CONCERNS
     - **Reason**: P1 coverage 88% (below 90%)
     - **Document**: [gate-decision-story-1.3.md](_bmad/output/gate-decision-story-1.3.md)
     - **Action**: Deploy with follow-up story for AC-5
     ```

2. **Generate stakeholder notification** (if `notify_stakeholders: true`):
   - Create concise summary message for team communication
   - Include: Decision, key metrics, action items
   - Format for Slack/email/chat:

   ```
   🚦 Quality Gate Decision: Story 1.3 - User Login

   Decision: ⚠️ CONCERNS
   - P0 Coverage: ✅ 100%
   - P1 Coverage: ⚠️ 88% (below 90%)
   - Test Pass Rate: ✅ 96%

   Action Required:
   - Create follow-up story for AC-5 E2E test
   - Deploy to staging for validation

   Full Report: _bmad/output/gate-decision-story-1.3.md
   ```

3. **Request sign-off** (if `require_sign_off: true`):
   - Prompt for named approver (tech lead, QA lead, PM)
   - Document approver name and timestamp in gate decision
   - Block until sign-off received (interactive prompt)

**Output:** Status tracking updated, stakeholders notified, sign-off obtained (if required)

**Workflow Complete**: Both Phase 1 (traceability) and Phase 2 (gate decision) deliverables generated.

---

## Decision Matrix (Quick Reference)

| Scenario        | P0 Cov            | P1 Cov | Overall Cov | P0 Pass | P1 Pass | Overall Pass | NFRs | Decision     |
| --------------- | ----------------- | ------ | ----------- | ------- | ------- | ------------ | ---- | ------------ |
| All green       | 100%              | ≥90%   | ≥80%        | 100%    | ≥95%    | ≥90%         | Pass | **PASS**     |
| Minor gap       | 100%              | 80-89% | ≥80%        | 100%    | 90-94%  | 85-89%       | Pass | **CONCERNS** |
| Missing P0      | <100%             | -      | -           | -       | -       | -            | -    | **FAIL**     |
| P0 test fail    | 100%              | -      | -           | <100%   | -       | -            | -    | **FAIL**     |
| P1 gap          | 100%              | <80%   | -           | 100%    | -       | -            | -    | **FAIL**     |
| NFR fail        | 100%              | ≥90%   | ≥80%        | 100%    | ≥95%    | ≥90%         | Fail | **FAIL**     |
| Security issue  | -                 | -      | -           | -       | -       | -            | Yes  | **FAIL**     |
| Business waiver | [FAIL conditions] | -      | -           | -       | -       | -            | -    | **WAIVED**   |

---

## Waiver Management

**When to use waivers:**

- Time-boxed MVP releases (known gaps, follow-up planned)
- Low-risk P1 gaps with mitigation (manual testing, monitoring)
- Technical debt acknowledged by product/engineering leadership
- External dependencies blocking test automation

**Waiver approval process:**

1. Document gap and risk in gate decision
2. Propose mitigation plan (manual testing, follow-up stories, monitoring)
3. Request approval from stakeholder (EM, PM, QA lead)
4. Link approval evidence (email, chat thread, meeting notes)
5. Add waiver to gate decision document
6. Create follow-up stories to close gaps

**Waiver does NOT apply to:**

- P0 gaps (always blocking)
- Critical security issues (always blocking)
- Critical NFR failures (performance, data integrity)

---

## Example Gate Decisions

### Example 1: PASS (All Criteria Met)

```
Decision: ✅ PASS

Summary: All quality criteria met. Story 1.3 is ready for production deployment.

Evidence:
- P0 Coverage: 100% (5/5 criteria)
- P1 Coverage: 95% (19/20 criteria)
- Overall Coverage: 92% (24/26 criteria)
- P0 Pass Rate: 100% (12/12 tests)
- P1 Pass Rate: 98% (45/46 tests)
- Overall Pass Rate: 96% (67/70 tests)
- NFRs: All pass (performance, security, scalability)

Action: Deploy to production ✅
```

### Example 2: CONCERNS (Minor Gap, Non-Blocking)

```
Decision: ⚠️ CONCERNS

Summary: P1 coverage slightly below threshold (88% vs 90%). Recommend deploying with follow-up story.

Evidence:
- P0 Coverage: 100% ✅
- P1 Coverage: 88% ⚠️ (below 90%)
- Overall Coverage: 92% ✅
- Test Pass Rate: 96% ✅
- Gap: AC-5 (P1) missing E2E test

Action:
- Deploy to staging for validation
- Create follow-up story for AC-5 E2E test
- Monitor production for edge cases related to AC-5
```

### Example 3: FAIL (P0 Gap, Blocking)

```
Decision: ❌ FAIL

Summary: P0 coverage incomplete. Missing critical validation test. BLOCKING deployment.

Evidence:
- P0 Coverage: 80% ❌ (4/5 criteria, AC-2 missing)
- AC-2: "User cannot login with invalid credentials" (P0 priority)
- No tests validate login security for invalid credentials
- This is a critical security gap

Action:
- Add P0 test for AC-2: 1.3-E2E-004 (invalid credentials)
- Re-run traceability after test added
- Re-evaluate gate decision after P0 coverage = 100%

Deployment BLOCKED until P0 gap resolved ❌
```

### Example 4: WAIVED (Business Decision)

```
Decision: ⚠️ WAIVED

Summary: P1 coverage below threshold (75% vs 90%), but waived for MVP launch.

Evidence:
- P0 Coverage: 100% ✅
- P1 Coverage: 75% ❌ (below 90%)
- Gap: 5 P1 criteria missing E2E tests (error handling, edge cases)

Waiver:
- Approver: Jane Doe, Engineering Manager
- Date: 2025-01-15
- Justification: Time-boxed MVP for investor demo. Core functionality (P0) fully validated. P1 gaps are low-risk edge cases.
- Mitigation: Manual QA testing for P1 scenarios, follow-up stories created for automated tests in v1.1
- Evidence: Slack #engineering 2025-01-15 3:42pm

Action:
- Deploy to production with manual QA validation ✅
- Add 5 E2E tests for P1 gaps in v1.1 sprint
- Monitor production logs for edge case occurrences
```

---

## Non-Prescriptive Approach

**Minimal Examples:** This workflow provides principles and patterns, not rigid templates. Teams should adapt the traceability and gate decision formats to their needs.

**Key Patterns to Follow:**

- Map criteria to tests explicitly (don't rely on inference alone)
- Prioritize by risk (P0 gaps are critical, P3 gaps are acceptable)
- Check coverage at appropriate levels (E2E for journeys, Unit for logic)
- Verify test quality (explicit assertions, no flakiness)
- Apply deterministic gate rules for consistency
- Document gate decisions with clear evidence
- Use waivers judiciously (business approved, mitigation planned)

**Extend as Needed:**

- Add custom coverage classifications
- Integrate with code coverage tools (Istanbul, NYC)
- Link to external traceability systems (JIRA, Azure DevOps)
- Add compliance or regulatory requirements
- Customize gate decision thresholds per project
- Add manual approval workflows for gate decisions

---

## Coverage Classification Details

### FULL Coverage

- All scenarios validated at appropriate test level(s)
- Edge cases considered
- Both happy path and error paths tested
- Assertions are explicit and complete

### PARTIAL Coverage

- Some scenarios validated but missing edge cases
- Only happy path tested (missing error paths)
- Assertions present but incomplete
- Coverage exists but needs enhancement

### NONE Coverage

- No tests found for this criterion
- Complete gap requiring new tests
- Critical if P0/P1, acceptable if P3

### UNIT-ONLY Coverage

- Only unit tests exist (business logic validated)
- Missing integration or E2E validation
- Risk: Implementation may not work end-to-end
- Recommendation: Add integration or E2E tests for critical paths

### INTEGRATION-ONLY Coverage

- Only API or Component tests exist
- Missing unit test confidence for business logic
- Risk: Logic errors may not be caught quickly
- Recommendation: Add unit tests for complex algorithms or state machines

---

## Duplicate Coverage Detection

Use selective testing principles from `selective-testing.md`:

**Acceptable Overlap:**

- Unit tests for business logic + E2E tests for user journey (different aspects)
- API tests for contract + E2E tests for full workflow (defense in depth for critical paths)

**Unacceptable Duplication:**

- Same validation at multiple levels (e.g., E2E testing math logic better suited for unit tests)
- Multiple E2E tests covering identical user path
- Component tests duplicating unit test logic

**Recommendation Pattern:**

- Test logic at unit level
- Test integration at API/Component level
- Test user experience at E2E level
- Avoid testing framework behavior at any level

---

## Integration with BMad Artifacts

### With test-design.md

- Use risk assessment to prioritize gap remediation
- Reference test priorities (P0/P1/P2/P3) for severity classification and gate decision
- Align traceability with originally planned test coverage

### With tech-spec.md

- Understand technical implementation details
- Map criteria to specific code modules
- Verify tests cover technical edge cases

### With PRD.md

- Understand full product context
- Verify acceptance criteria align with product goals
- Check for unstated requirements that need coverage

### With nfr-assessment.md

- Load non-functional validation results for gate decision
- Check critical NFR status (performance, security, scalability)
- Include NFR pass/fail in gate decision criteria

---

## Quality Gates (Phase 1 Recommendations)

### P0 Coverage (Critical Paths)

- **Requirement:** 100% FULL coverage
- **Severity:** BLOCKER if not met
- **Action:** Do not release until P0 coverage is complete

### P1 Coverage (High Priority)

- **Requirement:** 90% FULL coverage
- **Severity:** HIGH if not met
- **Action:** Block PR merge until addressed

### P2 Coverage (Medium Priority)

- **Requirement:** No strict requirement (recommended 80%)
- **Severity:** MEDIUM if gaps exist
- **Action:** Address in nightly test improvements

### P3 Coverage (Low Priority)

- **Requirement:** No requirement
- **Severity:** LOW if gaps exist
- **Action:** Optional - add if time permits

---

## Example Traceability Matrix

````markdown
# Traceability Matrix - Story 1.3

**Story:** User Authentication
**Date:** 2025-10-14
**Status:** 85% Coverage (1 HIGH gap)

## Coverage Summary

| Priority  | Total Criteria | FULL Coverage | Coverage % | Status  |
| --------- | -------------- | ------------- | ---------- | ------- |
| P0        | 3              | 3             | 100%       | ✅ PASS |
| P1        | 5              | 4             | 80%        | ⚠️ WARN |
| P2        | 4              | 3             | 75%        | ✅ PASS |
| P3        | 2              | 1             | 50%        | ✅ PASS |
| **Total** | **14**         | **11**        | **79%**    | ⚠️ WARN |

## Detailed Mapping

### AC-1: User can login with email and password (P0)

- **Coverage:** FULL ✅
- **Tests:**
  - `1.3-E2E-001` - tests/e2e/auth.spec.ts:12
    - Given: User has valid credentials
    - When: User submits login form
    - Then: User is redirected to dashboard
  - `1.3-UNIT-001` - tests/unit/auth-service.spec.ts:8
    - Given: Valid email and password hash
    - When: validateCredentials is called
    - Then: Returns user object

### AC-2: User sees error for invalid credentials (P0)

- **Coverage:** FULL ✅
- **Tests:**
  - `1.3-E2E-002` - tests/e2e/auth.spec.ts:28
    - Given: User has invalid password
    - When: User submits login form
    - Then: Error message is displayed
  - `1.3-UNIT-002` - tests/unit/auth-service.spec.ts:18
    - Given: Invalid password hash
    - When: validateCredentials is called
    - Then: Throws AuthenticationError

### AC-3: User can reset password via email (P1)

- **Coverage:** PARTIAL ⚠️
- **Tests:**
  - `1.3-E2E-003` - tests/e2e/auth.spec.ts:44
    - Given: User requests password reset
    - When: User clicks reset link
    - Then: User can set new password
- **Gaps:**
  - Missing: Email delivery validation
  - Missing: Expired token handling
  - Missing: Unit test for token generation
- **Recommendation:** Add `1.3-API-001` for email service integration and `1.3-UNIT-003` for token logic

## Gap Analysis

### Critical Gaps (BLOCKER)

- None ✅

### High Priority Gaps (PR BLOCKER)

1. **AC-3: Password reset email edge cases**
   - Missing tests for expired tokens, invalid tokens, email failures
   - Recommend: `1.3-API-001` (email service integration) and `1.3-E2E-004` (error paths)
   - Impact: Users may not be able to recover accounts in error scenarios

### Medium Priority Gaps (Nightly)

1. **AC-7: Session timeout handling** - UNIT-ONLY coverage (missing E2E validation)

## Quality Assessment

### Tests with Issues

- `1.3-E2E-001` ⚠️ - 145 seconds (exceeds 90s target) - Optimize fixture setup
- `1.3-UNIT-005` ⚠️ - 320 lines (exceeds 300 line limit) - Split into multiple test files

### Tests Passing Quality Gates

- 11/13 tests (85%) meet all quality criteria ✅

## Gate YAML Snippet

```yaml
traceability:
  story_id: '1.3'
  coverage:
    overall: 79%
    p0: 100%
    p1: 80%
    p2: 75%
    p3: 50%
  gaps:
    critical: 0
    high: 1
    medium: 1
    low: 1
  status: 'WARN' # P1 coverage below 90% threshold
  recommendations:
    - 'Add 1.3-API-001 for email service integration'
    - 'Add 1.3-E2E-004 for password reset error paths'
    - 'Optimize 1.3-E2E-001 performance (145s → <90s)'
```
````

## Recommendations

1. **Address High Priority Gap:** Add password reset edge case tests before PR merge
2. **Optimize Slow Test:** Refactor `1.3-E2E-001` to use faster fixture setup
3. **Split Large Test:** Break `1.3-UNIT-005` into focused test files
4. **Enhance P2 Coverage:** Add E2E validation for session timeout (currently UNIT-ONLY)

```

---

## Validation Checklist

Before completing this workflow, verify:

**Phase 1 (Traceability):**
- ✅ All acceptance criteria are mapped to tests (or gaps are documented)
- ✅ Coverage status is classified (FULL, PARTIAL, NONE, UNIT-ONLY, INTEGRATION-ONLY)
- ✅ Gaps are prioritized by risk level (P0/P1/P2/P3)
- ✅ P0 coverage is 100% or blockers are documented
- ✅ Duplicate coverage is identified and flagged
- ✅ Test quality is assessed (assertions, structure, performance)
- ✅ Traceability matrix is generated and saved

**Phase 2 (Gate Decision - if enabled):**
- ✅ Test execution results loaded and pass rates calculated
- ✅ NFR assessment results loaded (if applicable)
- ✅ Decision rules applied consistently (PASS/CONCERNS/FAIL/WAIVED)
- ✅ Gate decision document created with evidence
- ✅ Waiver documented if decision is WAIVED (approver, justification, mitigation)
- ✅ Workflow status updated (bmm-workflow-status.md)
- ✅ Stakeholders notified (if enabled)

---

## Notes

**Phase 1 (Traceability):**
- **Explicit Mapping:** Require tests to reference criteria explicitly (test IDs, describe blocks) for maintainability
- **Risk-Based Prioritization:** Use test-priorities framework (P0/P1/P2/P3) to determine gap severity
- **Quality Over Quantity:** Better to have fewer high-quality tests with FULL coverage than many low-quality tests with PARTIAL coverage
- **Selective Testing:** Avoid duplicate coverage - test each behavior at the appropriate level only

**Phase 2 (Gate Decision):**
- **Deterministic Rules:** Use consistent thresholds (P0=100%, P1≥90%, overall≥80%) for objectivity
- **Evidence-Based:** Every decision must cite specific metrics (coverage %, pass rates, NFRs)
- **Waiver Discipline:** Waivers require approver name, justification, mitigation plan, and evidence link
- **Non-Blocking CONCERNS:** Use CONCERNS for minor gaps that don't justify blocking deployment (e.g., P1 at 88% vs 90%)
- **Automate in CI/CD:** Generate YAML snippets that can be consumed by CI/CD pipelines for automated quality gates

---

## Troubleshooting

### "No tests found for this story"
- Run `*atdd` workflow first to generate failing acceptance tests
- Check test file naming conventions (may not match story ID pattern)
- Verify test directory path is correct

### "Cannot determine coverage status"
- Tests may lack explicit mapping to criteria (no test IDs, unclear describe blocks)
- Review test structure and add Given-When-Then narrative
- Add test IDs in format: `{STORY_ID}-{LEVEL}-{SEQ}` (e.g., 1.3-E2E-001)

### "P0 coverage below 100%"
- This is a **BLOCKER** - do not release
- Identify missing P0 tests in gap analysis
- Run `*atdd` workflow to generate missing tests
- Verify with stakeholders that P0 classification is correct

### "Duplicate coverage detected"
- Review selective testing principles in `selective-testing.md`
- Determine if overlap is acceptable (defense in depth) or wasteful (same validation at multiple levels)
- Consolidate tests at appropriate level (logic → unit, integration → API, journey → E2E)

### "Test execution results missing" (Phase 2)
- Phase 2 gate decision requires `test_results` (CI/CD test reports)
- If missing, Phase 2 will be skipped with warning
- Provide JUnit XML, TAP, or JSON test report path via `test_results` variable

### "Gate decision is FAIL but deployment needed urgently"
- Request business waiver (if `allow_waivers: true`)
- Document approver, justification, mitigation plan
- Create follow-up stories to address gaps
- Use WAIVED decision only for non-P0 gaps

---

## Related Workflows

**Prerequisites:**
- `testarch-test-design` - Define test priorities (P0/P1/P2/P3) before tracing (required for Phase 2)
- `testarch-atdd` or `testarch-automate` - Generate tests before tracing coverage

**Complements:**
- `testarch-nfr-assess` - Non-functional requirements validation (recommended for release gates)
- `testarch-test-review` - Review test quality issues flagged in traceability

**Next Steps:**
- If gate decision is PASS/CONCERNS → Deploy and monitor
- If gate decision is FAIL → Add missing tests, re-run trace workflow
- If gate decision is WAIVED → Deploy with mitigation, create follow-up stories

---

<!-- Powered by BMAD-CORE™ -->
```
