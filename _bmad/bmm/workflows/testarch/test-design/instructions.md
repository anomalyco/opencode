<!-- Powered by BMAD-CORE™ -->

# Test Design and Risk Assessment

**Workflow ID**: `_bmad/bmm/testarch/test-design`
**Version**: 4.0 (BMad v6)

---

## Overview

Plans comprehensive test coverage strategy with risk assessment, priority classification, and execution ordering. This workflow operates in **two modes**:

- **System-Level Mode (Phase 3)**: Testability review of architecture before solutioning gate check
- **Epic-Level Mode (Phase 4)**: Per-epic test planning with risk assessment (current behavior)

The workflow auto-detects which mode to use based on project phase.

---

## Preflight: Detect Mode and Load Context

**Critical:** Determine mode before proceeding.

### Mode Detection

1. **Check for sprint-status.yaml**
   - If `{implementation_artifacts}/sprint-status.yaml` exists → **Epic-Level Mode** (Phase 4)
   - If NOT exists → Check workflow status

2. **Check workflow-status.yaml**
   - Read `{planning_artifacts}/bmm-workflow-status.yaml`
   - If `implementation-readiness: required` or `implementation-readiness: recommended` → **System-Level Mode** (Phase 3)
   - Otherwise → **Epic-Level Mode** (Phase 4 without sprint status yet)

3. **Mode-Specific Requirements**

   **System-Level Mode (Phase 3 - Testability Review):**
   - ✅ Architecture document exists (architecture.md or tech-spec)
   - ✅ PRD exists with functional and non-functional requirements
   - ✅ Epics documented (epics.md)
   - ⚠️ Output: `{output_folder}/test-design-system.md`

   **Epic-Level Mode (Phase 4 - Per-Epic Planning):**
   - ✅ Story markdown with acceptance criteria available
   - ✅ PRD or epic documentation exists for context
   - ✅ Architecture documents available (optional but recommended)
   - ✅ Requirements are clear and testable
   - ⚠️ Output: `{output_folder}/test-design-epic-{epic_num}.md`

**Halt Condition:** If mode cannot be determined or required files missing, HALT and notify user with missing prerequisites.

---

## Step 1: Load Context (Mode-Aware)

**Mode-Specific Loading:**

### System-Level Mode (Phase 3)

1. **Read Architecture Documentation**
   - Load architecture.md or tech-spec (REQUIRED)
   - Load PRD.md for functional and non-functional requirements
   - Load epics.md for feature scope
   - Identify technology stack decisions (frameworks, databases, deployment targets)
   - Note integration points and external system dependencies
   - Extract NFR requirements (performance SLOs, security requirements, etc.)

2. **Check Playwright Utils Flag**

   Read `{config_source}` and check `config.tea_use_playwright_utils`.

   If true, note that `@seontechnologies/playwright-utils` provides utilities for test implementation. Reference in test design where relevant.

3. **Load Knowledge Base Fragments (System-Level)**

   **Critical:** Consult `{project-root}/_bmad/bmm/testarch/tea-index.csv` to load:
   - `nfr-criteria.md` - NFR validation approach (security, performance, reliability, maintainability)
   - `test-levels-framework.md` - Test levels strategy guidance
   - `risk-governance.md` - Testability risk identification
   - `test-quality.md` - Quality standards and Definition of Done

4. **Analyze Existing Test Setup (if brownfield)**
   - Search for existing test directories
   - Identify current test framework (if any)
   - Note testability concerns in existing codebase

### Epic-Level Mode (Phase 4)

1. **Read Requirements Documentation**
   - Load PRD.md for high-level product requirements
   - Read epics.md or specific epic for feature scope
   - Read story markdown for detailed acceptance criteria
   - Identify all testable requirements

2. **Load Architecture Context**
   - Read architecture.md for system design
   - Read tech-spec for implementation details
   - Read test-design-system.md (if exists from Phase 3)
   - Identify technical constraints and dependencies
   - Note integration points and external systems

3. **Analyze Existing Test Coverage**
   - Search for existing test files in `{test_dir}`
   - Identify coverage gaps
   - Note areas with insufficient testing
   - Check for flaky or outdated tests

4. **Load Knowledge Base Fragments (Epic-Level)**

   **Critical:** Consult `{project-root}/_bmad/bmm/testarch/tea-index.csv` to load:
   - `risk-governance.md` - Risk classification framework (6 categories: TECH, SEC, PERF, DATA, BUS, OPS), automated scoring, gate decision engine, owner tracking (625 lines, 4 examples)
   - `probability-impact.md` - Risk scoring methodology (probability × impact matrix, automated classification, dynamic re-assessment, gate integration, 604 lines, 4 examples)
   - `test-levels-framework.md` - Test level selection guidance (E2E vs API vs Component vs Unit with decision matrix, characteristics, when to use each, 467 lines, 4 examples)
   - `test-priorities-matrix.md` - P0-P3 prioritization criteria (automated priority calculation, risk-based mapping, tagging strategy, time budgets, 389 lines, 2 examples)

**Halt Condition (Epic-Level only):** If story data or acceptance criteria are missing, check if brownfield exploration is needed. If neither requirements NOR exploration possible, HALT with message: "Epic-level test design requires clear requirements, acceptance criteria, or brownfield app URL for exploration"

---

## Step 1.5: System-Level Testability Review (Phase 3 Only)

**Skip this step if Epic-Level Mode.** This step only executes in System-Level Mode.

### Actions

1. **Review Architecture for Testability**

   Evaluate architecture against these criteria:

   **Controllability:**
   - Can we control system state for testing? (API seeding, factories, database reset)
   - Are external dependencies mockable? (interfaces, dependency injection)
   - Can we trigger error conditions? (chaos engineering, fault injection)

   **Observability:**
   - Can we inspect system state? (logging, metrics, traces)
   - Are test results deterministic? (no race conditions, clear success/failure)
   - Can we validate NFRs? (performance metrics, security audit logs)

   **Reliability:**
   - Are tests isolated? (parallel-safe, stateless, cleanup discipline)
   - Can we reproduce failures? (deterministic waits, HAR capture, seed data)
   - Are components loosely coupled? (mockable, testable boundaries)

2. **Identify Architecturally Significant Requirements (ASRs)**

   From PRD NFRs and architecture decisions, identify quality requirements that:
   - Drive architecture decisions (e.g., "Must handle 10K concurrent users" → caching architecture)
   - Pose testability challenges (e.g., "Sub-second response time" → performance test infrastructure)
   - Require special test environments (e.g., "Multi-region deployment" → regional test instances)

   Score each ASR using risk matrix (probability × impact).

3. **Define Test Levels Strategy**

   Based on architecture (mobile, web, API, microservices, monolith):
   - Recommend unit/integration/E2E split (e.g., 70/20/10 for API-heavy, 40/30/30 for UI-heavy)
   - Identify test environment needs (local, staging, ephemeral, production-like)
   - Define testing approach per technology (Playwright for web, Maestro for mobile, k6 for performance)

4. **Assess NFR Testing Approach**

   For each NFR category:
   - **Security**: Auth/authz tests, OWASP validation, secret handling (Playwright E2E + security tools)
   - **Performance**: Load/stress/spike testing with k6, SLO/SLA thresholds
   - **Reliability**: Error handling, retries, circuit breakers, health checks (Playwright + API tests)
   - **Maintainability**: Coverage targets, code quality gates, observability validation

5. **Flag Testability Concerns**

   Identify architecture decisions that harm testability:
   - ❌ Tight coupling (no interfaces, hard dependencies)
   - ❌ No dependency injection (can't mock external services)
   - ❌ Hardcoded configurations (can't test different envs)
   - ❌ Missing observability (can't validate NFRs)
   - ❌ Stateful designs (can't parallelize tests)

   **Critical:** If testability concerns are blockers (e.g., "Architecture makes performance testing impossible"), document as CONCERNS or FAIL recommendation for gate check.

6. **Output System-Level Test Design**

   Write to `{output_folder}/test-design-system.md` containing:

   ```markdown
   # System-Level Test Design

   ## Testability Assessment

   - Controllability: [PASS/CONCERNS/FAIL with details]
   - Observability: [PASS/CONCERNS/FAIL with details]
   - Reliability: [PASS/CONCERNS/FAIL with details]

   ## Architecturally Significant Requirements (ASRs)

   [Risk-scored quality requirements]

   ## Test Levels Strategy

   - Unit: [X%] - [Rationale]
   - Integration: [Y%] - [Rationale]
   - E2E: [Z%] - [Rationale]

   ## NFR Testing Approach

   - Security: [Approach with tools]
   - Performance: [Approach with tools]
   - Reliability: [Approach with tools]
   - Maintainability: [Approach with tools]

   ## Test Environment Requirements

   [Infrastructure needs based on deployment architecture]

   ## Testability Concerns (if any)

   [Blockers or concerns that should inform solutioning gate check]

   ## Recommendations for Sprint 0

   [Specific actions for *framework and *ci workflows]
   ```

**After System-Level Mode:** Skip to Step 4 (Generate Deliverables) - Steps 2-3 are epic-level only.

---

## Step 1.6: Exploratory Mode Selection (Epic-Level Only)

### Actions

1. **Detect Planning Mode**

   Determine mode based on context:

   **Requirements-Based Mode (DEFAULT)**:
   - Have clear story/PRD with acceptance criteria
   - Uses: Existing workflow (Steps 2-4)
   - Appropriate for: Documented features, greenfield projects

   **Exploratory Mode (OPTIONAL - Brownfield)**:
   - Missing/incomplete requirements AND brownfield application exists
   - Uses: UI exploration to discover functionality
   - Appropriate for: Undocumented brownfield apps, legacy systems

2. **Requirements-Based Mode (DEFAULT - Skip to Step 2)**

   If requirements are clear:
   - Continue with existing workflow (Step 2: Assess and Classify Risks)
   - Use loaded requirements from Step 1
   - Proceed with risk assessment based on documented requirements

3. **Exploratory Mode (OPTIONAL - Brownfield Apps)**

   If exploring brownfield application:

   **A. Check MCP Availability**

   If config.tea_use_mcp_enhancements is true AND Playwright MCP tools available:
   - Use MCP-assisted exploration (Step 3.B)

   If MCP unavailable OR config.tea_use_mcp_enhancements is false:
   - Use manual exploration fallback (Step 3.C)

   **B. MCP-Assisted Exploration (If MCP Tools Available)**

   Use Playwright MCP browser tools to explore UI:

   **Setup:**

   ```
   1. Use planner_setup_page to initialize browser
   2. Navigate to {exploration_url}
   3. Capture initial state with browser_snapshot
   ```

   **Exploration Process:**

   ```
   4. Use browser_navigate to explore different pages
   5. Use browser_click to interact with buttons, links, forms
   6. Use browser_hover to reveal hidden menus/tooltips
   7. Capture browser_snapshot at each significant state
   8. Take browser_screenshot for documentation
   9. Monitor browser_console_messages for JavaScript errors
   10. Track browser_network_requests to identify API calls
   11. Map user flows and interactive elements
   12. Document discovered functionality
   ```

   **Discovery Documentation:**
   - Create list of discovered features (pages, workflows, forms)
   - Identify user journeys (navigation paths)
   - Map API endpoints (from network requests)
   - Note error states (from console messages)
   - Capture screenshots for visual reference

   **Convert to Test Scenarios:**
   - Transform discoveries into testable requirements
   - Prioritize based on user flow criticality
   - Identify risks from discovered functionality
   - Continue with Step 2 (Assess and Classify Risks) using discovered requirements

   **C. Manual Exploration Fallback (If MCP Unavailable)**

   If Playwright MCP is not available:

   **Notify User:**

   ```markdown
   Exploratory mode enabled but Playwright MCP unavailable.

   **Manual exploration required:**

   1. Open application at: {exploration_url}
   2. Explore all pages, workflows, and features
   3. Document findings in markdown:
      - List of pages/features discovered
      - User journeys identified
      - API endpoints observed (DevTools Network tab)
      - JavaScript errors noted (DevTools Console)
      - Critical workflows mapped

   4. Provide exploration findings to continue workflow

   **Alternative:** Disable exploratory_mode and provide requirements documentation
   ```

   Wait for user to provide exploration findings, then:
   - Parse user-provided discovery documentation
   - Convert to testable requirements
   - Continue with Step 2 (risk assessment)

4. **Proceed to Risk Assessment**

   After mode selection (Requirements-Based OR Exploratory):
   - Continue to Step 2: Assess and Classify Risks
   - Use requirements from documentation (Requirements-Based) OR discoveries (Exploratory)

---

## Step 2: Assess and Classify Risks

### Actions

1. **Identify Genuine Risks**

   Filter requirements to isolate actual risks (not just features):
   - Unresolved technical gaps
   - Security vulnerabilities
   - Performance bottlenecks
   - Data loss or corruption potential
   - Business impact failures
   - Operational deployment issues

2. **Classify Risks by Category**

   Use these standard risk categories:

   **TECH** (Technical/Architecture):
   - Architecture flaws
   - Integration failures
   - Scalability issues
   - Technical debt

   **SEC** (Security):
   - Missing access controls
   - Authentication bypass
   - Data exposure
   - Injection vulnerabilities

   **PERF** (Performance):
   - SLA violations
   - Response time degradation
   - Resource exhaustion
   - Scalability limits

   **DATA** (Data Integrity):
   - Data loss
   - Data corruption
   - Inconsistent state
   - Migration failures

   **BUS** (Business Impact):
   - User experience degradation
   - Business logic errors
   - Revenue impact
   - Compliance violations

   **OPS** (Operations):
   - Deployment failures
   - Configuration errors
   - Monitoring gaps
   - Rollback issues

3. **Score Risk Probability**

   Rate likelihood (1-3):
   - **1 (Unlikely)**: <10% chance, edge case
   - **2 (Possible)**: 10-50% chance, known scenario
   - **3 (Likely)**: >50% chance, common occurrence

4. **Score Risk Impact**

   Rate severity (1-3):
   - **1 (Minor)**: Cosmetic, workaround exists, limited users
   - **2 (Degraded)**: Feature impaired, workaround difficult, affects many users
   - **3 (Critical)**: System failure, data loss, no workaround, blocks usage

5. **Calculate Risk Score**

   ```
   Risk Score = Probability × Impact

   Scores:
   1-2: Low risk (monitor)
   3-4: Medium risk (plan mitigation)
   6-9: High risk (immediate mitigation required)
   ```

6. **Highlight High-Priority Risks**

   Flag all risks with score ≥6 for immediate attention.

7. **Request Clarification**

   If evidence is missing or assumptions required:
   - Document assumptions clearly
   - Request user clarification
   - Do NOT speculate on business impact

8. **Plan Mitigations**

   For each high-priority risk:
   - Define mitigation strategy
   - Assign owner (dev, QA, ops)
   - Set timeline
   - Update residual risk expectation

---

## Step 3: Design Test Coverage

### Actions

1. **Break Down Acceptance Criteria**

   Convert each acceptance criterion into atomic test scenarios:
   - One scenario per testable behavior
   - Scenarios are independent
   - Scenarios are repeatable
   - Scenarios tie back to risk mitigations

2. **Select Appropriate Test Levels**

   **Knowledge Base Reference**: `test-levels-framework.md`

   Map requirements to optimal test levels (avoid duplication):

   **E2E (End-to-End)**:
   - Critical user journeys
   - Multi-system integration
   - Production-like environment
   - Highest confidence, slowest execution

   **API (Integration)**:
   - Service contracts
   - Business logic validation
   - Fast feedback
   - Good for complex scenarios

   **Component**:
   - UI component behavior
   - Interaction testing
   - Visual regression
   - Fast, isolated

   **Unit**:
   - Business logic
   - Edge cases
   - Error handling
   - Fastest, most granular

   **Avoid duplicate coverage**: Don't test same behavior at multiple levels unless necessary.

3. **Assign Priority Levels**

   **Knowledge Base Reference**: `test-priorities-matrix.md`

   **P0 (Critical)**:
   - Blocks core user journey
   - High-risk areas (score ≥6)
   - Revenue-impacting
   - Security-critical
   - **Run on every commit**

   **P1 (High)**:
   - Important user features
   - Medium-risk areas (score 3-4)
   - Common workflows
   - **Run on PR to main**

   **P2 (Medium)**:
   - Secondary features
   - Low-risk areas (score 1-2)
   - Edge cases
   - **Run nightly or weekly**

   **P3 (Low)**:
   - Nice-to-have
   - Exploratory
   - Performance benchmarks
   - **Run on-demand**

4. **Outline Data and Tooling Prerequisites**

   For each test scenario, identify:
   - Test data requirements (factories, fixtures)
   - External services (mocks, stubs)
   - Environment setup
   - Tools and dependencies

5. **Define Execution Order**

   Recommend test execution sequence:
   1. **Smoke tests** (P0 subset, <5 min)
   2. **P0 tests** (critical paths, <10 min)
   3. **P1 tests** (important features, <30 min)
   4. **P2/P3 tests** (full regression, <60 min)

---

## Step 4: Generate Deliverables

### Actions

1. **Create Risk Assessment Matrix**

   Use template structure:

   ```markdown
   | Risk ID | Category | Description | Probability | Impact | Score | Mitigation      |
   | ------- | -------- | ----------- | ----------- | ------ | ----- | --------------- |
   | R-001   | SEC      | Auth bypass | 2           | 3      | 6     | Add authz check |
   ```

2. **Create Coverage Matrix**

   ```markdown
   | Requirement | Test Level | Priority | Risk Link | Test Count | Owner |
   | ----------- | ---------- | -------- | --------- | ---------- | ----- |
   | Login flow  | E2E        | P0       | R-001     | 3          | QA    |
   ```

3. **Document Execution Order**

   ```markdown
   ### Smoke Tests (<5 min)

   - Login successful
   - Dashboard loads

   ### P0 Tests (<10 min)

   - [Full P0 list]

   ### P1 Tests (<30 min)

   - [Full P1 list]
   ```

4. **Include Resource Estimates**

   ```markdown
   ### Test Effort Estimates

   - P0 scenarios: 15 tests × 2 hours = 30 hours
   - P1 scenarios: 25 tests × 1 hour = 25 hours
   - P2 scenarios: 40 tests × 0.5 hour = 20 hours
   - **Total:** 75 hours (~10 days)
   ```

5. **Add Gate Criteria**

   ```markdown
   ### Quality Gate Criteria

   - All P0 tests pass (100%)
   - P1 tests pass rate ≥95%
   - No high-risk (score ≥6) items unmitigated
   - Test coverage ≥80% for critical paths
   ```

6. **Write to Output File**

   Save to `{output_folder}/test-design-epic-{epic_num}.md` using template structure.

---

## Important Notes

### Risk Category Definitions

**TECH** (Technical/Architecture):

- Architecture flaws or technical debt
- Integration complexity
- Scalability concerns

**SEC** (Security):

- Missing security controls
- Authentication/authorization gaps
- Data exposure risks

**PERF** (Performance):

- SLA risk or performance degradation
- Resource constraints
- Scalability bottlenecks

**DATA** (Data Integrity):

- Data loss or corruption potential
- State consistency issues
- Migration risks

**BUS** (Business Impact):

- User experience harm
- Business logic errors
- Revenue or compliance impact

**OPS** (Operations):

- Deployment or runtime failures
- Configuration issues
- Monitoring/observability gaps

### Risk Scoring Methodology

**Probability × Impact = Risk Score**

Examples:

- High likelihood (3) × Critical impact (3) = **Score 9** (highest priority)
- Possible (2) × Critical (3) = **Score 6** (high priority threshold)
- Unlikely (1) × Minor (1) = **Score 1** (low priority)

**Threshold**: Scores ≥6 require immediate mitigation.

### Test Level Selection Strategy

**Avoid duplication:**

- Don't test same behavior at E2E and API level
- Use E2E for critical paths only
- Use API tests for complex business logic
- Use unit tests for edge cases

**Tradeoffs:**

- E2E: High confidence, slow execution, brittle
- API: Good balance, fast, stable
- Unit: Fastest feedback, narrow scope

### Priority Assignment Guidelines

**P0 criteria** (all must be true):

- Blocks core functionality
- High-risk (score ≥6)
- No workaround exists
- Affects majority of users

**P1 criteria**:

- Important feature
- Medium risk (score 3-5)
- Workaround exists but difficult

**P2/P3**: Everything else, prioritized by value

### Knowledge Base Integration

**Core Fragments (Auto-loaded in Step 1):**

- `risk-governance.md` - Risk classification (6 categories), automated scoring, gate decision engine, coverage traceability, owner tracking (625 lines, 4 examples)
- `probability-impact.md` - Probability × impact matrix, automated classification thresholds, dynamic re-assessment, gate integration (604 lines, 4 examples)
- `test-levels-framework.md` - E2E vs API vs Component vs Unit decision framework with characteristics matrix (467 lines, 4 examples)
- `test-priorities-matrix.md` - P0-P3 automated priority calculation, risk-based mapping, tagging strategy, time budgets (389 lines, 2 examples)

**Reference for Test Planning:**

- `selective-testing.md` - Execution strategy: tag-based, spec filters, diff-based selection, promotion rules (727 lines, 4 examples)
- `fixture-architecture.md` - Data setup patterns: pure function → fixture → mergeTests, auto-cleanup (406 lines, 5 examples)

**Manual Reference (Optional):**

- Use `tea-index.csv` to find additional specialized fragments as needed

### Evidence-Based Assessment

**Critical principle:** Base risk assessment on evidence, not speculation.

**Evidence sources:**

- PRD and user research
- Architecture documentation
- Historical bug data
- User feedback
- Security audit results

**Avoid:**

- Guessing business impact
- Assuming user behavior
- Inventing requirements

**When uncertain:** Document assumptions and request clarification from user.

---

## Output Summary

After completing this workflow, provide a summary:

```markdown
## Test Design Complete

**Epic**: {epic_num}
**Scope**: {design_level}

**Risk Assessment**:

- Total risks identified: {count}
- High-priority risks (≥6): {high_count}
- Categories: {categories}

**Coverage Plan**:

- P0 scenarios: {p0_count} ({p0_hours} hours)
- P1 scenarios: {p1_count} ({p1_hours} hours)
- P2/P3 scenarios: {p2p3_count} ({p2p3_hours} hours)
- **Total effort**: {total_hours} hours (~{total_days} days)

**Test Levels**:

- E2E: {e2e_count}
- API: {api_count}
- Component: {component_count}
- Unit: {unit_count}

**Quality Gate Criteria**:

- P0 pass rate: 100%
- P1 pass rate: ≥95%
- High-risk mitigations: 100%
- Coverage: ≥80%

**Output File**: {output_file}

**Next Steps**:

1. Review risk assessment with team
2. Prioritize mitigation for high-risk items (score ≥6)
3. Run `*atdd` to generate failing tests for P0 scenarios (separate workflow; not auto-run by `*test-design`)
4. Allocate resources per effort estimates
5. Set up test data factories and fixtures
```

---

## Validation

After completing all steps, verify:

- [ ] Risk assessment complete with all categories
- [ ] All risks scored (probability × impact)
- [ ] High-priority risks (≥6) flagged
- [ ] Coverage matrix maps requirements to test levels
- [ ] Priority levels assigned (P0-P3)
- [ ] Execution order defined
- [ ] Resource estimates provided
- [ ] Quality gate criteria defined
- [ ] Output file created and formatted correctly

Refer to `checklist.md` for comprehensive validation criteria.
