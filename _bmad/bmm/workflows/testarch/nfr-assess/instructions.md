# Non-Functional Requirements Assessment - Instructions v4.0

**Workflow:** `testarch-nfr`
**Purpose:** Assess non-functional requirements (performance, security, reliability, maintainability) before release with evidence-based validation
**Agent:** Test Architect (TEA)
**Format:** Pure Markdown v4.0 (no XML blocks)

---

## Overview

This workflow performs a comprehensive assessment of non-functional requirements (NFRs) to validate that the implementation meets performance, security, reliability, and maintainability standards before release. It uses evidence-based validation with deterministic PASS/CONCERNS/FAIL rules and provides actionable recommendations for remediation.

**Key Capabilities:**

- Assess multiple NFR categories (performance, security, reliability, maintainability, custom)
- Validate NFRs against defined thresholds from tech specs, PRD, or defaults
- Classify status deterministically (PASS/CONCERNS/FAIL) based on evidence
- Never guess thresholds - mark as CONCERNS if unknown
- Generate gate-ready YAML snippets for CI/CD integration
- Provide quick wins and recommended actions for remediation
- Create evidence checklists for gaps

---

## Prerequisites

**Required:**

- Implementation deployed locally or accessible for evaluation
- Evidence sources available (test results, metrics, logs, CI results)

**Recommended:**

- NFR requirements defined in tech-spec.md, PRD.md, or story
- Test results from performance, security, reliability tests
- Application metrics (response times, error rates, throughput)
- CI/CD pipeline results for burn-in validation

**Halt Conditions:**

- If NFR targets are undefined and cannot be obtained, halt and request definition
- If implementation is not accessible for evaluation, halt and request deployment

---

## Workflow Steps

### Step 1: Load Context and Knowledge Base

**Actions:**

1. Load relevant knowledge fragments from `{project-root}/_bmad/bmm/testarch/tea-index.csv`:
   - `nfr-criteria.md` - Non-functional requirements criteria and thresholds (security, performance, reliability, maintainability with code examples, 658 lines, 4 examples)
   - `ci-burn-in.md` - CI/CD burn-in patterns for reliability validation (10-iteration detection, sharding, selective execution, 678 lines, 4 examples)
   - `test-quality.md` - Test quality expectations for maintainability (deterministic, isolated, explicit assertions, length/time limits, 658 lines, 5 examples)
   - `playwright-config.md` - Performance configuration patterns: parallelization, timeout standards, artifact output (722 lines, 5 examples)
   - `error-handling.md` - Reliability validation patterns: scoped exceptions, retry validation, telemetry logging, graceful degradation (736 lines, 4 examples)

2. Read story file (if provided):
   - Extract NFR requirements
   - Identify specific thresholds or SLAs
   - Note any custom NFR categories

3. Read related BMad artifacts (if available):
   - `tech-spec.md` - Technical NFR requirements and targets
   - `PRD.md` - Product-level NFR context (user expectations)
   - `test-design.md` - NFR test plan and priorities

**Output:** Complete understanding of NFR targets, evidence sources, and validation criteria

---

### Step 2: Identify NFR Categories and Thresholds

**Actions:**

1. Determine which NFR categories to assess (default: performance, security, reliability, maintainability):
   - **Performance**: Response time, throughput, resource usage
   - **Security**: Authentication, authorization, data protection, vulnerability scanning
   - **Reliability**: Error handling, recovery, availability, fault tolerance
   - **Maintainability**: Code quality, test coverage, documentation, technical debt

2. Add custom NFR categories if specified (e.g., accessibility, internationalization, compliance)

3. Gather thresholds for each NFR:
   - From tech-spec.md (primary source)
   - From PRD.md (product-level SLAs)
   - From story file (feature-specific requirements)
   - From workflow variables (default thresholds)
   - Mark thresholds as UNKNOWN if not defined

4. Never guess thresholds - if a threshold is unknown, mark the NFR as CONCERNS

**Output:** Complete list of NFRs to assess with defined (or UNKNOWN) thresholds

---

### Step 3: Gather Evidence

**Actions:**

1. For each NFR category, discover evidence sources:

   **Performance Evidence:**
   - Load test results (JMeter, k6, Lighthouse)
   - Application metrics (response times, throughput, resource usage)
   - Performance monitoring data (New Relic, Datadog, APM)
   - Playwright performance traces (if applicable)

   **Security Evidence:**
   - Security scan results (SAST, DAST, dependency scanning)
   - Authentication/authorization test results
   - Penetration test reports
   - Vulnerability assessment reports
   - Compliance audit results

   **Reliability Evidence:**
   - Error logs and error rates
   - Uptime monitoring data
   - Chaos engineering test results
   - Failover/recovery test results
   - CI burn-in results (stability over time)

   **Maintainability Evidence:**
   - Code coverage reports (Istanbul, NYC, c8)
   - Static analysis results (ESLint, SonarQube)
   - Technical debt metrics
   - Documentation completeness
   - Test quality assessment (from test-review workflow)

2. Read relevant files from evidence directories:
   - `{test_results_dir}` for test execution results
   - `{metrics_dir}` for application metrics
   - `{logs_dir}` for application logs
   - CI/CD pipeline results (if `include_ci_results` is true)

3. Mark NFRs without evidence as "NO EVIDENCE" - never infer or assume

**Output:** Comprehensive evidence inventory for each NFR

---

### Step 4: Assess NFRs with Deterministic Rules

**Actions:**

1. For each NFR, apply deterministic PASS/CONCERNS/FAIL rules:

   **PASS Criteria:**
   - Evidence exists AND meets defined threshold
   - No concerns flagged in evidence
   - Example: Response time is 350ms (threshold: 500ms) → PASS

   **CONCERNS Criteria:**
   - Threshold is UNKNOWN (not defined)
   - Evidence is MISSING or INCOMPLETE
   - Evidence is close to threshold (within 10%)
   - Evidence shows intermittent issues
   - Example: Response time is 480ms (threshold: 500ms, 96% of threshold) → CONCERNS

   **FAIL Criteria:**
   - Evidence exists BUT does not meet threshold
   - Critical evidence is MISSING
   - Evidence shows consistent failures
   - Example: Response time is 750ms (threshold: 500ms) → FAIL

2. Document findings for each NFR:
   - Status (PASS/CONCERNS/FAIL)
   - Evidence source (file path, test name, metric name)
   - Actual value vs threshold
   - Justification for status classification

3. Classify severity based on category:
   - **CRITICAL**: Security failures, reliability failures (affect users immediately)
   - **HIGH**: Performance failures, maintainability failures (affect users soon)
   - **MEDIUM**: Concerns without failures (may affect users eventually)
   - **LOW**: Missing evidence for non-critical NFRs

**Output:** Complete NFR assessment with deterministic status classifications

---

### Step 5: Identify Quick Wins and Recommended Actions

**Actions:**

1. For each NFR with CONCERNS or FAIL status, identify quick wins:
   - Low-effort, high-impact improvements
   - Configuration changes (no code changes needed)
   - Optimization opportunities (caching, indexing, compression)
   - Monitoring additions (detect issues before they become failures)

2. Provide recommended actions for each issue:
   - Specific steps to remediate (not generic advice)
   - Priority (CRITICAL, HIGH, MEDIUM, LOW)
   - Estimated effort (hours, days)
   - Owner suggestion (dev, ops, security)

3. Suggest monitoring hooks for gaps:
   - Add performance monitoring (APM, synthetic monitoring)
   - Add error tracking (Sentry, Rollbar, error logs)
   - Add security monitoring (intrusion detection, audit logs)
   - Add alerting thresholds (notify before thresholds are breached)

4. Suggest fail-fast mechanisms:
   - Add circuit breakers for reliability
   - Add rate limiting for performance
   - Add validation gates for security
   - Add smoke tests for maintainability

**Output:** Actionable remediation plan with prioritized recommendations

---

### Step 6: Generate Deliverables

**Actions:**

1. Create NFR assessment markdown file:
   - Use template from `nfr-report-template.md`
   - Include executive summary (overall status, critical issues)
   - Add NFR-by-NFR assessment (status, evidence, thresholds)
   - Add findings summary (PASS count, CONCERNS count, FAIL count)
   - Add quick wins section
   - Add recommended actions section
   - Add evidence gaps checklist
   - Save to `{output_folder}/nfr-assessment.md`

2. Generate gate YAML snippet (if enabled):

   ```yaml
   nfr_assessment:
     date: '2025-10-14'
     categories:
       performance: 'PASS'
       security: 'CONCERNS'
       reliability: 'PASS'
       maintainability: 'PASS'
     overall_status: 'CONCERNS'
     critical_issues: 0
     high_priority_issues: 1
     concerns: 2
     blockers: false
   ```

3. Generate evidence checklist (if enabled):
   - List all NFRs with MISSING or INCOMPLETE evidence
   - Assign owners for evidence collection
   - Suggest evidence sources (tests, metrics, logs)
   - Set deadlines for evidence collection

4. Update story file (if enabled and requested):
   - Add "NFR Assessment" section to story markdown
   - Link to NFR assessment report
   - Include overall status and critical issues
   - Add gate status

**Output:** Complete NFR assessment documentation ready for review and CI/CD integration

---

## Non-Prescriptive Approach

**Minimal Examples:** This workflow provides principles and patterns, not rigid templates. Teams should adapt NFR categories, thresholds, and assessment criteria to their needs.

**Key Patterns to Follow:**

- Use evidence-based validation (no guessing or inference)
- Apply deterministic rules (consistent PASS/CONCERNS/FAIL classification)
- Never guess thresholds (mark as CONCERNS if unknown)
- Provide actionable recommendations (specific steps, not generic advice)
- Generate gate-ready artifacts (YAML snippets for CI/CD)

**Extend as Needed:**

- Add custom NFR categories (accessibility, internationalization, compliance)
- Integrate with external tools (New Relic, Datadog, SonarQube, JIRA)
- Add custom thresholds and rules
- Link to external assessment systems

---

## NFR Categories and Criteria

### Performance

**Criteria:**

- Response time (p50, p95, p99 percentiles)
- Throughput (requests per second, transactions per second)
- Resource usage (CPU, memory, disk, network)
- Scalability (horizontal, vertical)

**Thresholds (Default):**

- Response time p95: 500ms
- Throughput: 100 RPS
- CPU usage: < 70% average
- Memory usage: < 80% max

**Evidence Sources:**

- Load test results (JMeter, k6, Gatling)
- APM data (New Relic, Datadog, Dynatrace)
- Lighthouse reports (for web apps)
- Playwright performance traces

---

### Security

**Criteria:**

- Authentication (login security, session management)
- Authorization (access control, permissions)
- Data protection (encryption, PII handling)
- Vulnerability management (SAST, DAST, dependency scanning)
- Compliance (GDPR, HIPAA, PCI-DSS)

**Thresholds (Default):**

- Security score: >= 85/100
- Critical vulnerabilities: 0
- High vulnerabilities: < 3
- Authentication strength: MFA enabled

**Evidence Sources:**

- SAST results (SonarQube, Checkmarx, Veracode)
- DAST results (OWASP ZAP, Burp Suite)
- Dependency scanning (Snyk, Dependabot, npm audit)
- Penetration test reports
- Security audit logs

---

### Reliability

**Criteria:**

- Availability (uptime percentage)
- Error handling (graceful degradation, error recovery)
- Fault tolerance (redundancy, failover)
- Disaster recovery (backup, restore, RTO/RPO)
- Stability (CI burn-in, chaos engineering)

**Thresholds (Default):**

- Uptime: >= 99.9% (three nines)
- Error rate: < 0.1% (1 in 1000 requests)
- MTTR (Mean Time To Recovery): < 15 minutes
- CI burn-in: 100 consecutive successful runs

**Evidence Sources:**

- Uptime monitoring (Pingdom, UptimeRobot, StatusCake)
- Error logs and error rates
- CI burn-in results (see `ci-burn-in.md`)
- Chaos engineering test results (Chaos Monkey, Gremlin)
- Incident reports and postmortems

---

### Maintainability

**Criteria:**

- Code quality (complexity, duplication, code smells)
- Test coverage (unit, integration, E2E)
- Documentation (code comments, README, architecture docs)
- Technical debt (debt ratio, code churn)
- Test quality (from test-review workflow)

**Thresholds (Default):**

- Test coverage: >= 80%
- Code quality score: >= 85/100
- Technical debt ratio: < 5%
- Documentation completeness: >= 90%

**Evidence Sources:**

- Coverage reports (Istanbul, NYC, c8, JaCoCo)
- Static analysis (ESLint, SonarQube, CodeClimate)
- Documentation audit (manual or automated)
- Test review report (from test-review workflow)
- Git metrics (code churn, commit frequency)

---

## Deterministic Assessment Rules

### PASS Rules

- Evidence exists
- Evidence meets or exceeds threshold
- No concerns flagged
- Quality is acceptable

**Example:**

```markdown
NFR: Response Time p95
Threshold: 500ms
Evidence: Load test result shows 350ms p95
Status: PASS ✅
```

---

### CONCERNS Rules

- Threshold is UNKNOWN
- Evidence is MISSING or INCOMPLETE
- Evidence is close to threshold (within 10%)
- Evidence shows intermittent issues
- Quality is marginal

**Example:**

```markdown
NFR: Response Time p95
Threshold: 500ms
Evidence: Load test result shows 480ms p95 (96% of threshold)
Status: CONCERNS ⚠️
Recommendation: Optimize before production - very close to threshold
```

---

### FAIL Rules

- Evidence exists BUT does not meet threshold
- Critical evidence is MISSING
- Evidence shows consistent failures
- Quality is unacceptable

**Example:**

```markdown
NFR: Response Time p95
Threshold: 500ms
Evidence: Load test result shows 750ms p95 (150% of threshold)
Status: FAIL ❌
Recommendation: BLOCKER - optimize performance before release
```

---

## Integration with BMad Artifacts

### With tech-spec.md

- Primary source for NFR requirements and thresholds
- Load performance targets, security requirements, reliability SLAs
- Use architectural decisions to understand NFR trade-offs

### With test-design.md

- Understand NFR test plan and priorities
- Reference test priorities (P0/P1/P2/P3) for severity classification
- Align assessment with planned NFR validation

### With PRD.md

- Understand product-level NFR expectations
- Verify NFRs align with user experience goals
- Check for unstated NFR requirements (implied by product goals)

---

## Quality Gates

### Release Blocker (FAIL)

- Critical NFR has FAIL status (security, reliability)
- Performance failure affects user experience severely
- Do not release until FAIL is resolved

### PR Blocker (HIGH CONCERNS)

- High-priority NFR has FAIL status
- Multiple CONCERNS exist
- Block PR merge until addressed

### Warning (CONCERNS)

- Any NFR has CONCERNS status
- Evidence is missing or incomplete
- Address before next release

### Pass (PASS)

- All NFRs have PASS status
- No blockers or concerns
- Ready for release

---

## Example NFR Assessment

````markdown
# NFR Assessment - Story 1.3

**Feature:** User Authentication
**Date:** 2025-10-14
**Overall Status:** CONCERNS ⚠️ (1 HIGH issue)

## Executive Summary

**Assessment:** 3 PASS, 1 CONCERNS, 0 FAIL
**Blockers:** None
**High Priority Issues:** 1 (Security - MFA not enforced)
**Recommendation:** Address security concern before release

## Performance Assessment

### Response Time (p95)

- **Status:** PASS ✅
- **Threshold:** 500ms
- **Actual:** 320ms (64% of threshold)
- **Evidence:** Load test results (test-results/load-2025-10-14.json)
- **Findings:** Response time well below threshold across all percentiles

### Throughput

- **Status:** PASS ✅
- **Threshold:** 100 RPS
- **Actual:** 250 RPS (250% of threshold)
- **Evidence:** Load test results (test-results/load-2025-10-14.json)
- **Findings:** System handles 2.5x target load without degradation

## Security Assessment

### Authentication Strength

- **Status:** CONCERNS ⚠️
- **Threshold:** MFA enabled for all users
- **Actual:** MFA optional (not enforced)
- **Evidence:** Security audit (security-audit-2025-10-14.md)
- **Findings:** MFA is implemented but not enforced by default
- **Recommendation:** HIGH - Enforce MFA for all new accounts, provide migration path for existing users

### Data Protection

- **Status:** PASS ✅
- **Threshold:** PII encrypted at rest and in transit
- **Actual:** AES-256 at rest, TLS 1.3 in transit
- **Evidence:** Security scan (security-scan-2025-10-14.json)
- **Findings:** All PII properly encrypted

## Reliability Assessment

### Uptime

- **Status:** PASS ✅
- **Threshold:** 99.9% (three nines)
- **Actual:** 99.95% over 30 days
- **Evidence:** Uptime monitoring (uptime-report-2025-10-14.csv)
- **Findings:** Exceeds target with margin

### Error Rate

- **Status:** PASS ✅
- **Threshold:** < 0.1% (1 in 1000)
- **Actual:** 0.05% (1 in 2000)
- **Evidence:** Error logs (logs/errors-2025-10.log)
- **Findings:** Error rate well below threshold

## Maintainability Assessment

### Test Coverage

- **Status:** PASS ✅
- **Threshold:** >= 80%
- **Actual:** 87%
- **Evidence:** Coverage report (coverage/lcov-report/index.html)
- **Findings:** Coverage exceeds threshold with good distribution

### Code Quality

- **Status:** PASS ✅
- **Threshold:** >= 85/100
- **Actual:** 92/100
- **Evidence:** SonarQube analysis (sonarqube-report-2025-10-14.pdf)
- **Findings:** High code quality score with low technical debt

## Quick Wins

1. **Enforce MFA (Security)** - HIGH - 4 hours
   - Add configuration flag to enforce MFA for new accounts
   - No code changes needed, only config adjustment

## Recommended Actions

### Immediate (Before Release)

1. **Enforce MFA for all new accounts** - HIGH - 4 hours - Security Team
   - Add `ENFORCE_MFA=true` to production config
   - Update user onboarding flow to require MFA setup
   - Test MFA enforcement in staging environment

### Short-term (Next Sprint)

1. **Migrate existing users to MFA** - MEDIUM - 3 days - Product + Engineering
   - Design migration UX (prompt, incentives, deadline)
   - Implement migration flow with grace period
   - Communicate migration to existing users

## Evidence Gaps

- [ ] Chaos engineering test results (reliability)
  - Owner: DevOps Team
  - Deadline: 2025-10-21
  - Suggested evidence: Run chaos monkey tests in staging

- [ ] Penetration test report (security)
  - Owner: Security Team
  - Deadline: 2025-10-28
  - Suggested evidence: Schedule third-party pentest

## Gate YAML Snippet

```yaml
nfr_assessment:
  date: '2025-10-14'
  story_id: '1.3'
  categories:
    performance: 'PASS'
    security: 'CONCERNS'
    reliability: 'PASS'
    maintainability: 'PASS'
  overall_status: 'CONCERNS'
  critical_issues: 0
  high_priority_issues: 1
  medium_priority_issues: 0
  concerns: 1
  blockers: false
  recommendations:
    - 'Enforce MFA for all new accounts (HIGH - 4 hours)'
  evidence_gaps: 2
```
````

## Recommendations Summary

- **Release Blocker:** None ✅
- **High Priority:** 1 (Enforce MFA before release)
- **Medium Priority:** 1 (Migrate existing users to MFA)
- **Next Steps:** Address HIGH priority item, then proceed to gate workflow

```

---

## Validation Checklist

Before completing this workflow, verify:

- ✅ All NFR categories assessed (performance, security, reliability, maintainability, custom)
- ✅ Thresholds defined or marked as UNKNOWN
- ✅ Evidence gathered for each NFR (or marked as MISSING)
- ✅ Status classified deterministically (PASS/CONCERNS/FAIL)
- ✅ No thresholds were guessed (marked as CONCERNS if unknown)
- ✅ Quick wins identified for CONCERNS/FAIL
- ✅ Recommended actions are specific and actionable
- ✅ Evidence gaps documented with owners and deadlines
- ✅ NFR assessment report generated and saved
- ✅ Gate YAML snippet generated (if enabled)
- ✅ Evidence checklist generated (if enabled)

---

## Notes

- **Never Guess Thresholds:** If a threshold is unknown, mark as CONCERNS and recommend defining it
- **Evidence-Based:** Every assessment must be backed by evidence (tests, metrics, logs, CI results)
- **Deterministic Rules:** Use consistent PASS/CONCERNS/FAIL classification based on evidence
- **Actionable Recommendations:** Provide specific steps, not generic advice
- **Gate Integration:** Generate YAML snippets that can be consumed by CI/CD pipelines

---

## Troubleshooting

### "NFR thresholds not defined"
- Check tech-spec.md for NFR requirements
- Check PRD.md for product-level SLAs
- Check story file for feature-specific requirements
- If thresholds truly unknown, mark as CONCERNS and recommend defining them

### "No evidence found"
- Check evidence directories (test-results, metrics, logs)
- Check CI/CD pipeline for test results
- If evidence truly missing, mark NFR as "NO EVIDENCE" and recommend generating it

### "CONCERNS status but no threshold exceeded"
- CONCERNS is correct when threshold is UNKNOWN or evidence is MISSING/INCOMPLETE
- CONCERNS is also correct when evidence is close to threshold (within 10%)
- Document why CONCERNS was assigned

### "FAIL status blocks release"
- This is intentional - FAIL means critical NFR not met
- Recommend remediation actions with specific steps
- Re-run assessment after remediation

---

## Related Workflows

- **testarch-test-design** - Define NFR requirements and test plan
- **testarch-framework** - Set up performance/security testing frameworks
- **testarch-ci** - Configure CI/CD for NFR validation
- **testarch-gate** - Use NFR assessment as input for quality gate decisions
- **testarch-test-review** - Review test quality (maintainability NFR)

---

<!-- Powered by BMAD-CORE™ -->
```
