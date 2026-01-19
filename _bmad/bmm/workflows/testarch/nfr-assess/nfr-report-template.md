# NFR Assessment - {FEATURE_NAME}

**Date:** {DATE}
**Story:** {STORY_ID} (if applicable)
**Overall Status:** {OVERALL_STATUS} {STATUS_ICON}

---

Note: This assessment summarizes existing evidence; it does not run tests or CI workflows.

## Executive Summary

**Assessment:** {PASS_COUNT} PASS, {CONCERNS_COUNT} CONCERNS, {FAIL_COUNT} FAIL

**Blockers:** {BLOCKER_COUNT} {BLOCKER_DESCRIPTION}

**High Priority Issues:** {HIGH_PRIORITY_COUNT} {HIGH_PRIORITY_DESCRIPTION}

**Recommendation:** {OVERALL_RECOMMENDATION}

---

## Performance Assessment

### Response Time (p95)

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_VALUE}
- **Actual:** {ACTUAL_VALUE}
- **Evidence:** {EVIDENCE_SOURCE}
- **Findings:** {FINDINGS_DESCRIPTION}

### Throughput

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_VALUE}
- **Actual:** {ACTUAL_VALUE}
- **Evidence:** {EVIDENCE_SOURCE}
- **Findings:** {FINDINGS_DESCRIPTION}

### Resource Usage

- **CPU Usage**
  - **Status:** {STATUS} {STATUS_ICON}
  - **Threshold:** {THRESHOLD_VALUE}
  - **Actual:** {ACTUAL_VALUE}
  - **Evidence:** {EVIDENCE_SOURCE}

- **Memory Usage**
  - **Status:** {STATUS} {STATUS_ICON}
  - **Threshold:** {THRESHOLD_VALUE}
  - **Actual:** {ACTUAL_VALUE}
  - **Evidence:** {EVIDENCE_SOURCE}

### Scalability

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_DESCRIPTION}
- **Actual:** {ACTUAL_DESCRIPTION}
- **Evidence:** {EVIDENCE_SOURCE}
- **Findings:** {FINDINGS_DESCRIPTION}

---

## Security Assessment

### Authentication Strength

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_DESCRIPTION}
- **Actual:** {ACTUAL_DESCRIPTION}
- **Evidence:** {EVIDENCE_SOURCE}
- **Findings:** {FINDINGS_DESCRIPTION}
- **Recommendation:** {RECOMMENDATION} (if CONCERNS or FAIL)

### Authorization Controls

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_DESCRIPTION}
- **Actual:** {ACTUAL_DESCRIPTION}
- **Evidence:** {EVIDENCE_SOURCE}
- **Findings:** {FINDINGS_DESCRIPTION}

### Data Protection

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_DESCRIPTION}
- **Actual:** {ACTUAL_DESCRIPTION}
- **Evidence:** {EVIDENCE_SOURCE}
- **Findings:** {FINDINGS_DESCRIPTION}

### Vulnerability Management

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_DESCRIPTION} (e.g., "0 critical, <3 high vulnerabilities")
- **Actual:** {ACTUAL_DESCRIPTION} (e.g., "0 critical, 1 high, 5 medium vulnerabilities")
- **Evidence:** {EVIDENCE_SOURCE} (e.g., "Snyk scan results - scan-2025-10-14.json")
- **Findings:** {FINDINGS_DESCRIPTION}

### Compliance (if applicable)

- **Status:** {STATUS} {STATUS_ICON}
- **Standards:** {COMPLIANCE_STANDARDS} (e.g., "GDPR, HIPAA, PCI-DSS")
- **Actual:** {ACTUAL_COMPLIANCE_STATUS}
- **Evidence:** {EVIDENCE_SOURCE}
- **Findings:** {FINDINGS_DESCRIPTION}

---

## Reliability Assessment

### Availability (Uptime)

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_VALUE} (e.g., "99.9%")
- **Actual:** {ACTUAL_VALUE} (e.g., "99.95%")
- **Evidence:** {EVIDENCE_SOURCE} (e.g., "Uptime monitoring - uptime-report-2025-10-14.csv")
- **Findings:** {FINDINGS_DESCRIPTION}

### Error Rate

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_VALUE} (e.g., "<0.1%")
- **Actual:** {ACTUAL_VALUE} (e.g., "0.05%")
- **Evidence:** {EVIDENCE_SOURCE} (e.g., "Error logs - logs/errors-2025-10.log")
- **Findings:** {FINDINGS_DESCRIPTION}

### MTTR (Mean Time To Recovery)

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_VALUE} (e.g., "<15 minutes")
- **Actual:** {ACTUAL_VALUE} (e.g., "12 minutes")
- **Evidence:** {EVIDENCE_SOURCE} (e.g., "Incident reports - incidents/")
- **Findings:** {FINDINGS_DESCRIPTION}

### Fault Tolerance

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_DESCRIPTION}
- **Actual:** {ACTUAL_DESCRIPTION}
- **Evidence:** {EVIDENCE_SOURCE}
- **Findings:** {FINDINGS_DESCRIPTION}

### CI Burn-In (Stability)

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_VALUE} (e.g., "100 consecutive successful runs")
- **Actual:** {ACTUAL_VALUE} (e.g., "150 consecutive successful runs")
- **Evidence:** {EVIDENCE_SOURCE} (e.g., "CI burn-in results - ci-burn-in-2025-10-14.log")
- **Findings:** {FINDINGS_DESCRIPTION}

### Disaster Recovery (if applicable)

- **RTO (Recovery Time Objective)**
  - **Status:** {STATUS} {STATUS_ICON}
  - **Threshold:** {THRESHOLD_VALUE}
  - **Actual:** {ACTUAL_VALUE}
  - **Evidence:** {EVIDENCE_SOURCE}

- **RPO (Recovery Point Objective)**
  - **Status:** {STATUS} {STATUS_ICON}
  - **Threshold:** {THRESHOLD_VALUE}
  - **Actual:** {ACTUAL_VALUE}
  - **Evidence:** {EVIDENCE_SOURCE}

---

## Maintainability Assessment

### Test Coverage

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_VALUE} (e.g., ">=80%")
- **Actual:** {ACTUAL_VALUE} (e.g., "87%")
- **Evidence:** {EVIDENCE_SOURCE} (e.g., "Coverage report - coverage/lcov-report/index.html")
- **Findings:** {FINDINGS_DESCRIPTION}

### Code Quality

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_VALUE} (e.g., ">=85/100")
- **Actual:** {ACTUAL_VALUE} (e.g., "92/100")
- **Evidence:** {EVIDENCE_SOURCE} (e.g., "SonarQube analysis - sonarqube-report-2025-10-14.pdf")
- **Findings:** {FINDINGS_DESCRIPTION}

### Technical Debt

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_VALUE} (e.g., "<5% debt ratio")
- **Actual:** {ACTUAL_VALUE} (e.g., "3.2% debt ratio")
- **Evidence:** {EVIDENCE_SOURCE} (e.g., "CodeClimate analysis - codeclimate-2025-10-14.json")
- **Findings:** {FINDINGS_DESCRIPTION}

### Documentation Completeness

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_VALUE} (e.g., ">=90%")
- **Actual:** {ACTUAL_VALUE} (e.g., "95%")
- **Evidence:** {EVIDENCE_SOURCE} (e.g., "Documentation audit - docs-audit-2025-10-14.md")
- **Findings:** {FINDINGS_DESCRIPTION}

### Test Quality (from test-review, if available)

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_DESCRIPTION}
- **Actual:** {ACTUAL_DESCRIPTION}
- **Evidence:** {EVIDENCE_SOURCE} (e.g., "Test review report - test-review-2025-10-14.md")
- **Findings:** {FINDINGS_DESCRIPTION}

---

## Custom NFR Assessments (if applicable)

### {CUSTOM_NFR_NAME_1}

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_DESCRIPTION}
- **Actual:** {ACTUAL_DESCRIPTION}
- **Evidence:** {EVIDENCE_SOURCE}
- **Findings:** {FINDINGS_DESCRIPTION}

### {CUSTOM_NFR_NAME_2}

- **Status:** {STATUS} {STATUS_ICON}
- **Threshold:** {THRESHOLD_DESCRIPTION}
- **Actual:** {ACTUAL_DESCRIPTION}
- **Evidence:** {EVIDENCE_SOURCE}
- **Findings:** {FINDINGS_DESCRIPTION}

---

## Quick Wins

{QUICK_WIN_COUNT} quick wins identified for immediate implementation:

1. **{QUICK_WIN_TITLE_1}** ({NFR_CATEGORY}) - {PRIORITY} - {ESTIMATED_EFFORT}
   - {QUICK_WIN_DESCRIPTION}
   - No code changes needed / Minimal code changes

2. **{QUICK_WIN_TITLE_2}** ({NFR_CATEGORY}) - {PRIORITY} - {ESTIMATED_EFFORT}
   - {QUICK_WIN_DESCRIPTION}

---

## Recommended Actions

### Immediate (Before Release) - CRITICAL/HIGH Priority

1. **{ACTION_TITLE_1}** - {PRIORITY} - {ESTIMATED_EFFORT} - {OWNER}
   - {ACTION_DESCRIPTION}
   - {SPECIFIC_STEPS}
   - {VALIDATION_CRITERIA}

2. **{ACTION_TITLE_2}** - {PRIORITY} - {ESTIMATED_EFFORT} - {OWNER}
   - {ACTION_DESCRIPTION}
   - {SPECIFIC_STEPS}
   - {VALIDATION_CRITERIA}

### Short-term (Next Sprint) - MEDIUM Priority

1. **{ACTION_TITLE_3}** - {PRIORITY} - {ESTIMATED_EFFORT} - {OWNER}
   - {ACTION_DESCRIPTION}

2. **{ACTION_TITLE_4}** - {PRIORITY} - {ESTIMATED_EFFORT} - {OWNER}
   - {ACTION_DESCRIPTION}

### Long-term (Backlog) - LOW Priority

1. **{ACTION_TITLE_5}** - {PRIORITY} - {ESTIMATED_EFFORT} - {OWNER}
   - {ACTION_DESCRIPTION}

---

## Monitoring Hooks

{MONITORING_HOOK_COUNT} monitoring hooks recommended to detect issues before failures:

### Performance Monitoring

- [ ] {MONITORING_TOOL_1} - {MONITORING_DESCRIPTION}
  - **Owner:** {OWNER}
  - **Deadline:** {DEADLINE}

- [ ] {MONITORING_TOOL_2} - {MONITORING_DESCRIPTION}
  - **Owner:** {OWNER}
  - **Deadline:** {DEADLINE}

### Security Monitoring

- [ ] {MONITORING_TOOL_3} - {MONITORING_DESCRIPTION}
  - **Owner:** {OWNER}
  - **Deadline:** {DEADLINE}

### Reliability Monitoring

- [ ] {MONITORING_TOOL_4} - {MONITORING_DESCRIPTION}
  - **Owner:** {OWNER}
  - **Deadline:** {DEADLINE}

### Alerting Thresholds

- [ ] {ALERT_DESCRIPTION} - Notify when {THRESHOLD_CONDITION}
  - **Owner:** {OWNER}
  - **Deadline:** {DEADLINE}

---

## Fail-Fast Mechanisms

{FAIL_FAST_COUNT} fail-fast mechanisms recommended to prevent failures:

### Circuit Breakers (Reliability)

- [ ] {CIRCUIT_BREAKER_DESCRIPTION}
  - **Owner:** {OWNER}
  - **Estimated Effort:** {EFFORT}

### Rate Limiting (Performance)

- [ ] {RATE_LIMITING_DESCRIPTION}
  - **Owner:** {OWNER}
  - **Estimated Effort:** {EFFORT}

### Validation Gates (Security)

- [ ] {VALIDATION_GATE_DESCRIPTION}
  - **Owner:** {OWNER}
  - **Estimated Effort:** {EFFORT}

### Smoke Tests (Maintainability)

- [ ] {SMOKE_TEST_DESCRIPTION}
  - **Owner:** {OWNER}
  - **Estimated Effort:** {EFFORT}

---

## Evidence Gaps

{EVIDENCE_GAP_COUNT} evidence gaps identified - action required:

- [ ] **{NFR_NAME_1}** ({NFR_CATEGORY})
  - **Owner:** {OWNER}
  - **Deadline:** {DEADLINE}
  - **Suggested Evidence:** {SUGGESTED_EVIDENCE_SOURCE}
  - **Impact:** {IMPACT_DESCRIPTION}

- [ ] **{NFR_NAME_2}** ({NFR_CATEGORY})
  - **Owner:** {OWNER}
  - **Deadline:** {DEADLINE}
  - **Suggested Evidence:** {SUGGESTED_EVIDENCE_SOURCE}
  - **Impact:** {IMPACT_DESCRIPTION}

---

## Findings Summary

| Category        | PASS             | CONCERNS             | FAIL             | Overall Status                      |
| --------------- | ---------------- | -------------------- | ---------------- | ----------------------------------- |
| Performance     | {P_PASS_COUNT}   | {P_CONCERNS_COUNT}   | {P_FAIL_COUNT}   | {P_STATUS} {P_ICON}                 |
| Security        | {S_PASS_COUNT}   | {S_CONCERNS_COUNT}   | {S_FAIL_COUNT}   | {S_STATUS} {S_ICON}                 |
| Reliability     | {R_PASS_COUNT}   | {R_CONCERNS_COUNT}   | {R_FAIL_COUNT}   | {R_STATUS} {R_ICON}                 |
| Maintainability | {M_PASS_COUNT}   | {M_CONCERNS_COUNT}   | {M_FAIL_COUNT}   | {M_STATUS} {M_ICON}                 |
| **Total**       | **{TOTAL_PASS}** | **{TOTAL_CONCERNS}** | **{TOTAL_FAIL}** | **{OVERALL_STATUS} {OVERALL_ICON}** |

---

## Gate YAML Snippet

```yaml
nfr_assessment:
  date: '{DATE}'
  story_id: '{STORY_ID}'
  feature_name: '{FEATURE_NAME}'
  categories:
    performance: '{PERFORMANCE_STATUS}'
    security: '{SECURITY_STATUS}'
    reliability: '{RELIABILITY_STATUS}'
    maintainability: '{MAINTAINABILITY_STATUS}'
  overall_status: '{OVERALL_STATUS}'
  critical_issues: { CRITICAL_COUNT }
  high_priority_issues: { HIGH_COUNT }
  medium_priority_issues: { MEDIUM_COUNT }
  concerns: { CONCERNS_COUNT }
  blockers: { BLOCKER_BOOLEAN } # true/false
  quick_wins: { QUICK_WIN_COUNT }
  evidence_gaps: { EVIDENCE_GAP_COUNT }
  recommendations:
    - '{RECOMMENDATION_1}'
    - '{RECOMMENDATION_2}'
    - '{RECOMMENDATION_3}'
```

---

## Related Artifacts

- **Story File:** {STORY_FILE_PATH} (if applicable)
- **Tech Spec:** {TECH_SPEC_PATH} (if available)
- **PRD:** {PRD_PATH} (if available)
- **Test Design:** {TEST_DESIGN_PATH} (if available)
- **Evidence Sources:**
  - Test Results: {TEST_RESULTS_DIR}
  - Metrics: {METRICS_DIR}
  - Logs: {LOGS_DIR}
  - CI Results: {CI_RESULTS_PATH}

---

## Recommendations Summary

**Release Blocker:** {RELEASE_BLOCKER_SUMMARY}

**High Priority:** {HIGH_PRIORITY_SUMMARY}

**Medium Priority:** {MEDIUM_PRIORITY_SUMMARY}

**Next Steps:** {NEXT_STEPS_DESCRIPTION}

---

## Sign-Off

**NFR Assessment:**

- Overall Status: {OVERALL_STATUS} {OVERALL_ICON}
- Critical Issues: {CRITICAL_COUNT}
- High Priority Issues: {HIGH_COUNT}
- Concerns: {CONCERNS_COUNT}
- Evidence Gaps: {EVIDENCE_GAP_COUNT}

**Gate Status:** {GATE_STATUS} {GATE_ICON}

**Next Actions:**

- If PASS ✅: Proceed to `*gate` workflow or release
- If CONCERNS ⚠️: Address HIGH/CRITICAL issues, re-run `*nfr-assess`
- If FAIL ❌: Resolve FAIL status NFRs, re-run `*nfr-assess`

**Generated:** {DATE}
**Workflow:** testarch-nfr v4.0

---

<!-- Powered by BMAD-CORE™ -->
