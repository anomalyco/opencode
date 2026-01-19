# Test Design and Risk Assessment - Validation Checklist

## Prerequisites

- [ ] Story markdown with clear acceptance criteria exists
- [ ] PRD or epic documentation available
- [ ] Architecture documents available (optional)
- [ ] Requirements are testable and unambiguous

## Process Steps

### Step 1: Context Loading

- [ ] PRD.md read and requirements extracted
- [ ] Epics.md or specific epic documentation loaded
- [ ] Story markdown with acceptance criteria analyzed
- [ ] Architecture documents reviewed (if available)
- [ ] Existing test coverage analyzed
- [ ] Knowledge base fragments loaded (risk-governance, probability-impact, test-levels, test-priorities)

### Step 2: Risk Assessment

- [ ] Genuine risks identified (not just features)
- [ ] Risks classified by category (TECH/SEC/PERF/DATA/BUS/OPS)
- [ ] Probability scored (1-3 for each risk)
- [ ] Impact scored (1-3 for each risk)
- [ ] Risk scores calculated (probability × impact)
- [ ] High-priority risks (score ≥6) flagged
- [ ] Mitigation plans defined for high-priority risks
- [ ] Owners assigned for each mitigation
- [ ] Timelines set for mitigations
- [ ] Residual risk documented

### Step 3: Coverage Design

- [ ] Acceptance criteria broken into atomic scenarios
- [ ] Test levels selected (E2E/API/Component/Unit)
- [ ] No duplicate coverage across levels
- [ ] Priority levels assigned (P0/P1/P2/P3)
- [ ] P0 scenarios meet strict criteria (blocks core + high risk + no workaround)
- [ ] Data prerequisites identified
- [ ] Tooling requirements documented
- [ ] Execution order defined (smoke → P0 → P1 → P2/P3)

### Step 4: Deliverables Generation

- [ ] Risk assessment matrix created
- [ ] Coverage matrix created
- [ ] Execution order documented
- [ ] Resource estimates calculated
- [ ] Quality gate criteria defined
- [ ] Output file written to correct location
- [ ] Output file uses template structure

## Output Validation

### Risk Assessment Matrix

- [ ] All risks have unique IDs (R-001, R-002, etc.)
- [ ] Each risk has category assigned
- [ ] Probability values are 1, 2, or 3
- [ ] Impact values are 1, 2, or 3
- [ ] Scores calculated correctly (P × I)
- [ ] High-priority risks (≥6) clearly marked
- [ ] Mitigation strategies specific and actionable

### Coverage Matrix

- [ ] All requirements mapped to test levels
- [ ] Priorities assigned to all scenarios
- [ ] Risk linkage documented
- [ ] Test counts realistic
- [ ] Owners assigned where applicable
- [ ] No duplicate coverage (same behavior at multiple levels)

### Execution Order

- [ ] Smoke tests defined (<5 min target)
- [ ] P0 tests listed (<10 min target)
- [ ] P1 tests listed (<30 min target)
- [ ] P2/P3 tests listed (<60 min target)
- [ ] Order optimizes for fast feedback

### Resource Estimates

- [ ] P0 hours calculated (count × 2 hours)
- [ ] P1 hours calculated (count × 1 hour)
- [ ] P2 hours calculated (count × 0.5 hours)
- [ ] P3 hours calculated (count × 0.25 hours)
- [ ] Total hours summed
- [ ] Days estimate provided (hours / 8)
- [ ] Estimates include setup time

### Quality Gate Criteria

- [ ] P0 pass rate threshold defined (should be 100%)
- [ ] P1 pass rate threshold defined (typically ≥95%)
- [ ] High-risk mitigation completion required
- [ ] Coverage targets specified (≥80% recommended)

## Quality Checks

### Evidence-Based Assessment

- [ ] Risk assessment based on documented evidence
- [ ] No speculation on business impact
- [ ] Assumptions clearly documented
- [ ] Clarifications requested where needed
- [ ] Historical data referenced where available

### Risk Classification Accuracy

- [ ] TECH risks are architecture/integration issues
- [ ] SEC risks are security vulnerabilities
- [ ] PERF risks are performance/scalability concerns
- [ ] DATA risks are data integrity issues
- [ ] BUS risks are business/revenue impacts
- [ ] OPS risks are deployment/operational issues

### Priority Assignment Accuracy

- [ ] P0: Truly blocks core functionality
- [ ] P0: High-risk (score ≥6)
- [ ] P0: No workaround exists
- [ ] P1: Important but not blocking
- [ ] P2/P3: Nice-to-have or edge cases

### Test Level Selection

- [ ] E2E used only for critical paths
- [ ] API tests cover complex business logic
- [ ] Component tests for UI interactions
- [ ] Unit tests for edge cases and algorithms
- [ ] No redundant coverage

## Integration Points

### Knowledge Base Integration

- [ ] risk-governance.md consulted
- [ ] probability-impact.md applied
- [ ] test-levels-framework.md referenced
- [ ] test-priorities-matrix.md used
- [ ] Additional fragments loaded as needed

### Status File Integration

- [ ] bmm-workflow-status.md exists
- [ ] Test design logged in Quality & Testing Progress
- [ ] Epic number and scope documented
- [ ] Completion timestamp recorded

### Workflow Dependencies

- [ ] Can proceed to `*atdd` workflow with P0 scenarios
- [ ] `*atdd` is a separate workflow and must be run explicitly (not auto-run)
- [ ] Can proceed to `automate` workflow with full coverage plan
- [ ] Risk assessment informs `gate` workflow criteria
- [ ] Integrates with `ci` workflow execution order

## Completion Criteria

**All must be true:**

- [ ] All prerequisites met
- [ ] All process steps completed
- [ ] All output validations passed
- [ ] All quality checks passed
- [ ] All integration points verified
- [ ] Output file complete and well-formatted
- [ ] Team review scheduled (if required)

## Post-Workflow Actions

**User must complete:**

1. [ ] Review risk assessment with team
2. [ ] Prioritize mitigation for high-priority risks (score ≥6)
3. [ ] Allocate resources per estimates
4. [ ] Run `*atdd` workflow to generate P0 tests (separate workflow; not auto-run)
5. [ ] Set up test data factories and fixtures
6. [ ] Schedule team review of test design document

**Recommended next workflows:**

1. [ ] Run `atdd` workflow for P0 test generation
2. [ ] Run `framework` workflow if not already done
3. [ ] Run `ci` workflow to configure pipeline stages

## Rollback Procedure

If workflow fails:

1. [ ] Delete output file
2. [ ] Review error logs
3. [ ] Fix missing context (PRD, architecture docs)
4. [ ] Clarify ambiguous requirements
5. [ ] Retry workflow

## Notes

### Common Issues

**Issue**: Too many P0 tests

- **Solution**: Apply strict P0 criteria - must block core AND high risk AND no workaround

**Issue**: Risk scores all high

- **Solution**: Differentiate between high-impact (3) and degraded (2) impacts

**Issue**: Duplicate coverage across levels

- **Solution**: Use test pyramid - E2E for critical paths only

**Issue**: Resource estimates too high

- **Solution**: Invest in fixtures/factories to reduce per-test setup time

### Best Practices

- Base risk assessment on evidence, not assumptions
- High-priority risks (≥6) require immediate mitigation
- P0 tests should cover <10% of total scenarios
- Avoid testing same behavior at multiple levels
- Include smoke tests (P0 subset) for fast feedback

---

**Checklist Complete**: Sign off when all items validated.

**Completed by:** {name}
**Date:** {date}
**Epic:** {epic title}
**Notes:** {additional notes}
