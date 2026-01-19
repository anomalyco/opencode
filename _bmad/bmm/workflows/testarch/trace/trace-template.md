# Traceability Matrix & Gate Decision - Story {STORY_ID}

**Story:** {STORY_TITLE}
**Date:** {DATE}
**Evaluator:** {user_name or TEA Agent}

---

Note: This workflow does not generate tests. If gaps exist, run `*atdd` or `*automate` to create coverage.

## PHASE 1: REQUIREMENTS TRACEABILITY

### Coverage Summary

| Priority  | Total Criteria | FULL Coverage | Coverage % | Status       |
| --------- | -------------- | ------------- | ---------- | ------------ |
| P0        | {P0_TOTAL}     | {P0_FULL}     | {P0_PCT}%  | {P0_STATUS}  |
| P1        | {P1_TOTAL}     | {P1_FULL}     | {P1_PCT}%  | {P1_STATUS}  |
| P2        | {P2_TOTAL}     | {P2_FULL}     | {P2_PCT}%  | {P2_STATUS}  |
| P3        | {P3_TOTAL}     | {P3_FULL}     | {P3_PCT}%  | {P3_STATUS}  |
| **Total** | **{TOTAL}**    | **{FULL}**    | **{PCT}%** | **{STATUS}** |

**Legend:**

- ✅ PASS - Coverage meets quality gate threshold
- ⚠️ WARN - Coverage below threshold but not critical
- ❌ FAIL - Coverage below minimum threshold (blocker)

---

### Detailed Mapping

#### {CRITERION_ID}: {CRITERION_DESCRIPTION} ({PRIORITY})

- **Coverage:** {COVERAGE_STATUS} {STATUS_ICON}
- **Tests:**
  - `{TEST_ID}` - {TEST_FILE}:{LINE}
    - **Given:** {GIVEN}
    - **When:** {WHEN}
    - **Then:** {THEN}
  - `{TEST_ID_2}` - {TEST_FILE_2}:{LINE}
    - **Given:** {GIVEN_2}
    - **When:** {WHEN_2}
    - **Then:** {THEN_2}

- **Gaps:** (if PARTIAL or UNIT-ONLY or INTEGRATION-ONLY)
  - Missing: {MISSING_SCENARIO_1}
  - Missing: {MISSING_SCENARIO_2}

- **Recommendation:** {RECOMMENDATION_TEXT}

---

#### Example: AC-1: User can login with email and password (P0)

- **Coverage:** FULL ✅
- **Tests:**
  - `1.3-E2E-001` - tests/e2e/auth.spec.ts:12
    - **Given:** User has valid credentials
    - **When:** User submits login form
    - **Then:** User is redirected to dashboard
  - `1.3-UNIT-001` - tests/unit/auth-service.spec.ts:8
    - **Given:** Valid email and password hash
    - **When:** validateCredentials is called
    - **Then:** Returns user object

---

#### Example: AC-3: User can reset password via email (P1)

- **Coverage:** PARTIAL ⚠️
- **Tests:**
  - `1.3-E2E-003` - tests/e2e/auth.spec.ts:44
    - **Given:** User requests password reset
    - **When:** User clicks reset link in email
    - **Then:** User can set new password

- **Gaps:**
  - Missing: Email delivery validation
  - Missing: Expired token handling (error path)
  - Missing: Invalid token handling (security test)
  - Missing: Unit test for token generation logic

- **Recommendation:** Add `1.3-API-001` for email service integration testing and `1.3-UNIT-003` for token generation logic. Add `1.3-E2E-004` for error path validation (expired/invalid tokens).

---

### Gap Analysis

#### Critical Gaps (BLOCKER) ❌

{CRITICAL_GAP_COUNT} gaps found. **Do not release until resolved.**

1. **{CRITERION_ID}: {CRITERION_DESCRIPTION}** (P0)
   - Current Coverage: {COVERAGE_STATUS}
   - Missing Tests: {MISSING_TEST_DESCRIPTION}
   - Recommend: {RECOMMENDED_TEST_ID} ({RECOMMENDED_TEST_LEVEL})
   - Impact: {IMPACT_DESCRIPTION}

---

#### High Priority Gaps (PR BLOCKER) ⚠️

{HIGH_GAP_COUNT} gaps found. **Address before PR merge.**

1. **{CRITERION_ID}: {CRITERION_DESCRIPTION}** (P1)
   - Current Coverage: {COVERAGE_STATUS}
   - Missing Tests: {MISSING_TEST_DESCRIPTION}
   - Recommend: {RECOMMENDED_TEST_ID} ({RECOMMENDED_TEST_LEVEL})
   - Impact: {IMPACT_DESCRIPTION}

---

#### Medium Priority Gaps (Nightly) ⚠️

{MEDIUM_GAP_COUNT} gaps found. **Address in nightly test improvements.**

1. **{CRITERION_ID}: {CRITERION_DESCRIPTION}** (P2)
   - Current Coverage: {COVERAGE_STATUS}
   - Recommend: {RECOMMENDED_TEST_ID} ({RECOMMENDED_TEST_LEVEL})

---

#### Low Priority Gaps (Optional) ℹ️

{LOW_GAP_COUNT} gaps found. **Optional - add if time permits.**

1. **{CRITERION_ID}: {CRITERION_DESCRIPTION}** (P3)
   - Current Coverage: {COVERAGE_STATUS}

---

### Quality Assessment

#### Tests with Issues

**BLOCKER Issues** ❌

- `{TEST_ID}` - {ISSUE_DESCRIPTION} - {REMEDIATION}

**WARNING Issues** ⚠️

- `{TEST_ID}` - {ISSUE_DESCRIPTION} - {REMEDIATION}

**INFO Issues** ℹ️

- `{TEST_ID}` - {ISSUE_DESCRIPTION} - {REMEDIATION}

---

#### Example Quality Issues

**WARNING Issues** ⚠️

- `1.3-E2E-001` - 145 seconds (exceeds 90s target) - Optimize fixture setup to reduce test duration
- `1.3-UNIT-005` - 320 lines (exceeds 300 line limit) - Split into multiple focused test files

**INFO Issues** ℹ️

- `1.3-E2E-002` - Missing Given-When-Then structure - Refactor describe block to use BDD format

---

#### Tests Passing Quality Gates

**{PASSING_TEST_COUNT}/{TOTAL_TEST_COUNT} tests ({PASSING_PCT}%) meet all quality criteria** ✅

---

### Duplicate Coverage Analysis

#### Acceptable Overlap (Defense in Depth)

- {CRITERION_ID}: Tested at unit (business logic) and E2E (user journey) ✅

#### Unacceptable Duplication ⚠️

- {CRITERION_ID}: Same validation at E2E and Component level
  - Recommendation: Remove {TEST_ID} or consolidate with {OTHER_TEST_ID}

---

### Coverage by Test Level

| Test Level | Tests             | Criteria Covered     | Coverage %       |
| ---------- | ----------------- | -------------------- | ---------------- |
| E2E        | {E2E_COUNT}       | {E2E_CRITERIA}       | {E2E_PCT}%       |
| API        | {API_COUNT}       | {API_CRITERIA}       | {API_PCT}%       |
| Component  | {COMP_COUNT}      | {COMP_CRITERIA}      | {COMP_PCT}%      |
| Unit       | {UNIT_COUNT}      | {UNIT_CRITERIA}      | {UNIT_PCT}%      |
| **Total**  | **{TOTAL_TESTS}** | **{TOTAL_CRITERIA}** | **{TOTAL_PCT}%** |

---

### Traceability Recommendations

#### Immediate Actions (Before PR Merge)

1. **{ACTION_1}** - {DESCRIPTION}
2. **{ACTION_2}** - {DESCRIPTION}

#### Short-term Actions (This Sprint)

1. **{ACTION_1}** - {DESCRIPTION}
2. **{ACTION_2}** - {DESCRIPTION}

#### Long-term Actions (Backlog)

1. **{ACTION_1}** - {DESCRIPTION}

---

#### Example Recommendations

**Immediate Actions (Before PR Merge)**

1. **Add P1 Password Reset Tests** - Implement `1.3-API-001` for email service integration and `1.3-E2E-004` for error path validation. P1 coverage currently at 80%, target is 90%.
2. **Optimize Slow E2E Test** - Refactor `1.3-E2E-001` to use faster fixture setup. Currently 145s, target is <90s.

**Short-term Actions (This Sprint)**

1. **Enhance P2 Coverage** - Add E2E validation for session timeout (`1.3-E2E-005`). Currently UNIT-ONLY coverage.
2. **Split Large Test File** - Break `1.3-UNIT-005` (320 lines) into multiple focused test files (<300 lines each).

**Long-term Actions (Backlog)**

1. **Enrich P3 Coverage** - Add tests for edge cases in P3 criteria if time permits.

---

## PHASE 2: QUALITY GATE DECISION

**Gate Type:** {story | epic | release | hotfix}
**Decision Mode:** {deterministic | manual}

---

### Evidence Summary

#### Test Execution Results

- **Total Tests**: {total_count}
- **Passed**: {passed_count} ({pass_percentage}%)
- **Failed**: {failed_count} ({fail_percentage}%)
- **Skipped**: {skipped_count} ({skip_percentage}%)
- **Duration**: {total_duration}

**Priority Breakdown:**

- **P0 Tests**: {p0_passed}/{p0_total} passed ({p0_pass_rate}%) {✅ | ❌}
- **P1 Tests**: {p1_passed}/{p1_total} passed ({p1_pass_rate}%) {✅ | ⚠️ | ❌}
- **P2 Tests**: {p2_passed}/{p2_total} passed ({p2_pass_rate}%) {informational}
- **P3 Tests**: {p3_passed}/{p3_total} passed ({p3_pass_rate}%) {informational}

**Overall Pass Rate**: {overall_pass_rate}% {✅ | ⚠️ | ❌}

**Test Results Source**: {CI_run_id | test_report_url | local_run}

---

#### Coverage Summary (from Phase 1)

**Requirements Coverage:**

- **P0 Acceptance Criteria**: {p0_covered}/{p0_total} covered ({p0_coverage}%) {✅ | ❌}
- **P1 Acceptance Criteria**: {p1_covered}/{p1_total} covered ({p1_coverage}%) {✅ | ⚠️ | ❌}
- **P2 Acceptance Criteria**: {p2_covered}/{p2_total} covered ({p2_coverage}%) {informational}
- **Overall Coverage**: {overall_coverage}%

**Code Coverage** (if available):

- **Line Coverage**: {line_coverage}% {✅ | ⚠️ | ❌}
- **Branch Coverage**: {branch_coverage}% {✅ | ⚠️ | ❌}
- **Function Coverage**: {function_coverage}% {✅ | ⚠️ | ❌}

**Coverage Source**: {coverage_report_url | coverage_file_path}

---

#### Non-Functional Requirements (NFRs)

**Security**: {PASS | CONCERNS | FAIL | NOT_ASSESSED} {✅ | ⚠️ | ❌}

- Security Issues: {security_issue_count}
- {details_if_issues}

**Performance**: {PASS | CONCERNS | FAIL | NOT_ASSESSED} {✅ | ⚠️ | ❌}

- {performance_metrics_summary}

**Reliability**: {PASS | CONCERNS | FAIL | NOT_ASSESSED} {✅ | ⚠️ | ❌}

- {reliability_metrics_summary}

**Maintainability**: {PASS | CONCERNS | FAIL | NOT_ASSESSED} {✅ | ⚠️ | ❌}

- {maintainability_metrics_summary}

**NFR Source**: {nfr_assessment_file_path | not_assessed}

---

#### Flakiness Validation

**Burn-in Results** (if available):

- **Burn-in Iterations**: {iteration_count} (e.g., 10)
- **Flaky Tests Detected**: {flaky_test_count} {✅ if 0 | ❌ if >0}
- **Stability Score**: {stability_percentage}%

**Flaky Tests List** (if any):

- {flaky_test_1_name} - {failure_rate}
- {flaky_test_2_name} - {failure_rate}

**Burn-in Source**: {CI_burn_in_run_id | not_available}

---

### Decision Criteria Evaluation

#### P0 Criteria (Must ALL Pass)

| Criterion             | Threshold | Actual                    | Status   |
| --------------------- | --------- | ------------------------- | -------- | -------- |
| P0 Coverage           | 100%      | {p0_coverage}%            | {✅ PASS | ❌ FAIL} |
| P0 Test Pass Rate     | 100%      | {p0_pass_rate}%           | {✅ PASS | ❌ FAIL} |
| Security Issues       | 0         | {security_issue_count}    | {✅ PASS | ❌ FAIL} |
| Critical NFR Failures | 0         | {critical_nfr_fail_count} | {✅ PASS | ❌ FAIL} |
| Flaky Tests           | 0         | {flaky_test_count}        | {✅ PASS | ❌ FAIL} |

**P0 Evaluation**: {✅ ALL PASS | ❌ ONE OR MORE FAILED}

---

#### P1 Criteria (Required for PASS, May Accept for CONCERNS)

| Criterion              | Threshold                 | Actual               | Status   |
| ---------------------- | ------------------------- | -------------------- | -------- | ----------- | -------- |
| P1 Coverage            | ≥{min_p1_coverage}%       | {p1_coverage}%       | {✅ PASS | ⚠️ CONCERNS | ❌ FAIL} |
| P1 Test Pass Rate      | ≥{min_p1_pass_rate}%      | {p1_pass_rate}%      | {✅ PASS | ⚠️ CONCERNS | ❌ FAIL} |
| Overall Test Pass Rate | ≥{min_overall_pass_rate}% | {overall_pass_rate}% | {✅ PASS | ⚠️ CONCERNS | ❌ FAIL} |
| Overall Coverage       | ≥{min_coverage}%          | {overall_coverage}%  | {✅ PASS | ⚠️ CONCERNS | ❌ FAIL} |

**P1 Evaluation**: {✅ ALL PASS | ⚠️ SOME CONCERNS | ❌ FAILED}

---

#### P2/P3 Criteria (Informational, Don't Block)

| Criterion         | Actual          | Notes                                                        |
| ----------------- | --------------- | ------------------------------------------------------------ |
| P2 Test Pass Rate | {p2_pass_rate}% | {allow_p2_failures ? "Tracked, doesn't block" : "Evaluated"} |
| P3 Test Pass Rate | {p3_pass_rate}% | {allow_p3_failures ? "Tracked, doesn't block" : "Evaluated"} |

---

### GATE DECISION: {PASS | CONCERNS | FAIL | WAIVED}

---

### Rationale

{Explain decision based on criteria evaluation}

{Highlight key evidence that drove decision}

{Note any assumptions or caveats}

**Example (PASS):**

> All P0 criteria met with 100% coverage and pass rates across critical tests. All P1 criteria exceeded thresholds with 98% overall pass rate and 92% coverage. No security issues detected. No flaky tests in validation. Feature is ready for production deployment with standard monitoring.

**Example (CONCERNS):**

> All P0 criteria met, ensuring critical user journeys are protected. However, P1 coverage (88%) falls below threshold (90%) due to missing E2E test for AC-5 edge case. Overall pass rate (96%) is excellent. Issues are non-critical and have acceptable workarounds. Risk is low enough to deploy with enhanced monitoring.

**Example (FAIL):**

> CRITICAL BLOCKERS DETECTED:
>
> 1. P0 coverage incomplete (80%) - AC-2 security validation missing
> 2. P0 test failures (75% pass rate) in core search functionality
> 3. Unresolved SQL injection vulnerability in search filter (CRITICAL)
>
> Release MUST BE BLOCKED until P0 issues are resolved. Security vulnerability cannot be waived.

**Example (WAIVED):**

> Original decision was FAIL due to P0 test failure in legacy Excel 2007 export module (affects <1% of users). However, release contains critical GDPR compliance features required by regulatory deadline (Oct 15). Business has approved waiver given:
>
> - Regulatory priority overrides legacy module risk
> - Workaround available (use Excel 2010+)
> - Issue will be fixed in v2.4.1 hotfix (due Oct 20)
> - Enhanced monitoring in place

---

### {Section: Delete if not applicable}

#### Residual Risks (For CONCERNS or WAIVED)

List unresolved P1/P2 issues that don't block release but should be tracked:

1. **{Risk Description}**
   - **Priority**: P1 | P2
   - **Probability**: Low | Medium | High
   - **Impact**: Low | Medium | High
   - **Risk Score**: {probability × impact}
   - **Mitigation**: {workaround or monitoring plan}
   - **Remediation**: {fix in next sprint/release}

**Overall Residual Risk**: {LOW | MEDIUM | HIGH}

---

#### Waiver Details (For WAIVED only)

**Original Decision**: ❌ FAIL

**Reason for Failure**:

- {list_of_blocking_issues}

**Waiver Information**:

- **Waiver Reason**: {business_justification}
- **Waiver Approver**: {name}, {role} (e.g., Jane Doe, VP Engineering)
- **Approval Date**: {YYYY-MM-DD}
- **Waiver Expiry**: {YYYY-MM-DD} (**NOTE**: Does NOT apply to next release)

**Monitoring Plan**:

- {enhanced_monitoring_1}
- {enhanced_monitoring_2}
- {escalation_criteria}

**Remediation Plan**:

- **Fix Target**: {next_release_version} (e.g., v2.4.1 hotfix)
- **Due Date**: {YYYY-MM-DD}
- **Owner**: {team_or_person}
- **Verification**: {how_fix_will_be_verified}

**Business Justification**:
{detailed_explanation_of_why_waiver_is_acceptable}

---

#### Critical Issues (For FAIL or CONCERNS)

Top blockers requiring immediate attention:

| Priority | Issue         | Description         | Owner        | Due Date     | Status             |
| -------- | ------------- | ------------------- | ------------ | ------------ | ------------------ |
| P0       | {issue_title} | {brief_description} | {owner_name} | {YYYY-MM-DD} | {OPEN/IN_PROGRESS} |
| P0       | {issue_title} | {brief_description} | {owner_name} | {YYYY-MM-DD} | {OPEN/IN_PROGRESS} |
| P1       | {issue_title} | {brief_description} | {owner_name} | {YYYY-MM-DD} | {OPEN/IN_PROGRESS} |

**Blocking Issues Count**: {p0_blocker_count} P0 blockers, {p1_blocker_count} P1 issues

---

### Gate Recommendations

#### For PASS Decision ✅

1. **Proceed to deployment**
   - Deploy to staging environment
   - Validate with smoke tests
   - Monitor key metrics for 24-48 hours
   - Deploy to production with standard monitoring

2. **Post-Deployment Monitoring**
   - {metric_1_to_monitor}
   - {metric_2_to_monitor}
   - {alert_thresholds}

3. **Success Criteria**
   - {success_criterion_1}
   - {success_criterion_2}

---

#### For CONCERNS Decision ⚠️

1. **Deploy with Enhanced Monitoring**
   - Deploy to staging with extended validation period
   - Enable enhanced logging/monitoring for known risk areas:
     - {risk_area_1}
     - {risk_area_2}
   - Set aggressive alerts for potential issues
   - Deploy to production with caution

2. **Create Remediation Backlog**
   - Create story: "{fix_title_1}" (Priority: {priority})
   - Create story: "{fix_title_2}" (Priority: {priority})
   - Target sprint: {next_sprint}

3. **Post-Deployment Actions**
   - Monitor {specific_areas} closely for {time_period}
   - Weekly status updates on remediation progress
   - Re-assess after fixes deployed

---

#### For FAIL Decision ❌

1. **Block Deployment Immediately**
   - Do NOT deploy to any environment
   - Notify stakeholders of blocking issues
   - Escalate to tech lead and PM

2. **Fix Critical Issues**
   - Address P0 blockers listed in Critical Issues section
   - Owner assignments confirmed
   - Due dates agreed upon
   - Daily standup on blocker resolution

3. **Re-Run Gate After Fixes**
   - Re-run full test suite after fixes
   - Re-run `bmad tea *trace` workflow
   - Verify decision is PASS before deploying

---

#### For WAIVED Decision 🔓

1. **Deploy with Business Approval**
   - Confirm waiver approver has signed off
   - Document waiver in release notes
   - Notify all stakeholders of waived risks

2. **Aggressive Monitoring**
   - {enhanced_monitoring_plan}
   - {escalation_procedures}
   - Daily checks on waived risk areas

3. **Mandatory Remediation**
   - Fix MUST be completed by {due_date}
   - Issue CANNOT be waived in next release
   - Track remediation progress weekly
   - Verify fix in next gate

---

### Next Steps

**Immediate Actions** (next 24-48 hours):

1. {action_1}
2. {action_2}
3. {action_3}

**Follow-up Actions** (next sprint/release):

1. {action_1}
2. {action_2}
3. {action_3}

**Stakeholder Communication**:

- Notify PM: {decision_summary}
- Notify SM: {decision_summary}
- Notify DEV lead: {decision_summary}

---

## Integrated YAML Snippet (CI/CD)

```yaml
traceability_and_gate:
  # Phase 1: Traceability
  traceability:
    story_id: "{STORY_ID}"
    date: "{DATE}"
    coverage:
      overall: {OVERALL_PCT}%
      p0: {P0_PCT}%
      p1: {P1_PCT}%
      p2: {P2_PCT}%
      p3: {P3_PCT}%
    gaps:
      critical: {CRITICAL_COUNT}
      high: {HIGH_COUNT}
      medium: {MEDIUM_COUNT}
      low: {LOW_COUNT}
    quality:
      passing_tests: {PASSING_COUNT}
      total_tests: {TOTAL_TESTS}
      blocker_issues: {BLOCKER_COUNT}
      warning_issues: {WARNING_COUNT}
    recommendations:
      - "{RECOMMENDATION_1}"
      - "{RECOMMENDATION_2}"

  # Phase 2: Gate Decision
  gate_decision:
    decision: "{PASS | CONCERNS | FAIL | WAIVED}"
    gate_type: "{story | epic | release | hotfix}"
    decision_mode: "{deterministic | manual}"
    criteria:
      p0_coverage: {p0_coverage}%
      p0_pass_rate: {p0_pass_rate}%
      p1_coverage: {p1_coverage}%
      p1_pass_rate: {p1_pass_rate}%
      overall_pass_rate: {overall_pass_rate}%
      overall_coverage: {overall_coverage}%
      security_issues: {security_issue_count}
      critical_nfrs_fail: {critical_nfr_fail_count}
      flaky_tests: {flaky_test_count}
    thresholds:
      min_p0_coverage: 100
      min_p0_pass_rate: 100
      min_p1_coverage: {min_p1_coverage}
      min_p1_pass_rate: {min_p1_pass_rate}
      min_overall_pass_rate: {min_overall_pass_rate}
      min_coverage: {min_coverage}
    evidence:
      test_results: "{CI_run_id | test_report_url}"
      traceability: "{trace_file_path}"
      nfr_assessment: "{nfr_file_path}"
      code_coverage: "{coverage_report_url}"
    next_steps: "{brief_summary_of_recommendations}"
    waiver: # Only if WAIVED
      reason: "{business_justification}"
      approver: "{name}, {role}"
      expiry: "{YYYY-MM-DD}"
      remediation_due: "{YYYY-MM-DD}"
```

---

## Related Artifacts

- **Story File:** {STORY_FILE_PATH}
- **Test Design:** {TEST_DESIGN_PATH} (if available)
- **Tech Spec:** {TECH_SPEC_PATH} (if available)
- **Test Results:** {TEST_RESULTS_PATH}
- **NFR Assessment:** {NFR_FILE_PATH} (if available)
- **Test Files:** {TEST_DIR_PATH}

---

## Sign-Off

**Phase 1 - Traceability Assessment:**

- Overall Coverage: {OVERALL_PCT}%
- P0 Coverage: {P0_PCT}% {P0_STATUS}
- P1 Coverage: {P1_PCT}% {P1_STATUS}
- Critical Gaps: {CRITICAL_COUNT}
- High Priority Gaps: {HIGH_COUNT}

**Phase 2 - Gate Decision:**

- **Decision**: {PASS | CONCERNS | FAIL | WAIVED} {STATUS_ICON}
- **P0 Evaluation**: {✅ ALL PASS | ❌ ONE OR MORE FAILED}
- **P1 Evaluation**: {✅ ALL PASS | ⚠️ SOME CONCERNS | ❌ FAILED}

**Overall Status:** {STATUS} {STATUS_ICON}

**Next Steps:**

- If PASS ✅: Proceed to deployment
- If CONCERNS ⚠️: Deploy with monitoring, create remediation backlog
- If FAIL ❌: Block deployment, fix critical issues, re-run workflow
- If WAIVED 🔓: Deploy with business approval and aggressive monitoring

**Generated:** {DATE}
**Workflow:** testarch-trace v4.0 (Enhanced with Gate Decision)

---

<!-- Powered by BMAD-CORE™ -->
