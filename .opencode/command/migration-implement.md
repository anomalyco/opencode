---
description: "Generate a sprint-by-sprint migration implementation plan from a codebase or existing migration report"
---

> **If this migration targets Cloud One (C1)**, load the `anr-csp-knowledge` skill before proceeding. The implementation plan must align to the C1 sprint model from `CloudOne_DetailedSchedule_Template_Master_v1.0.csv` and include CDRL deliverable milestones from `A004_CloudOne_Configuration Management Plan_TEMPLATE_v1_4_1.md` and `A038_CloudOne_Test Script_TEMPLATE_v1_6_1.md`. C1 onboarding steps (account provisioning, VPC setup, FAMs access requests) are prerequisites that must appear in the plan before any technical migration work.

Analyze the codebase or migration report at: $ARGUMENTS

If no path is provided, analyze the current working directory.

## Your Task

Produce a detailed, sprint-by-sprint migration implementation plan as a markdown file. This plan should be directly usable as the basis for project scheduling — specific enough to create tickets from, but flexible enough to absorb real-world changes.

---

## Phase 1: Discovery

Determine what inputs are available:

1. **Existing migration report** — check for `migration-report.html` or `migration-report*.html` in the target directory. If present, extract: overall score, recommended approach, target platform, key risks, and blockers.
2. **Architecture document** — check for `ARCHITECTURE.md`. If present, extract: services, dependencies, interfaces, data stores.
3. **Dependency audit** — check for `dependency-audit.html`. If present, extract: critical/high findings that must be resolved before migration.
4. **Source code** — if no prior reports exist, read the codebase directly to understand: tech stack, architecture, data layer, external dependencies, auth mechanism, infrastructure signals.

The more prior deliverables exist, the faster this phase completes. If none exist, perform a condensed discovery equivalent to Phase 1 of the migration-report command.

---

## Phase 2: Define Migration Scope

Based on discovery, define:

### Migration Approach
- **Rehost (Lift & Shift)** — move as-is with minimal changes
- **Replatform** — move with targeted modifications (containerize, swap managed services)
- **Refactor** — significant code changes required (architecture, auth, interfaces)
- **Replace** — rebuild or purchase replacement

### Workstream Inventory

Identify every distinct body of work required:

| ID | Workstream | Description | Dependencies | Estimated Effort |
|----|-----------|-------------|--------------|-----------------|
| W1 | Infrastructure provisioning | CSP accounts, VPC, networking | None | |
| W2 | Auth/SSO integration | GCDS/SAML integration | W1 | |
| W3 | Database migration | Schema migration, data transfer | W1 | |
| W4 | Application containerization | Dockerfile, image build, registry | W1 | |
| W5 | Interface remediation | Port 443 compliance, partner coordination | W1 | |
| W6 | CI/CD pipeline | Build, test, deploy automation | W1, W4 | |
| W7 | Testing & validation | Functional, regression, security, UAT | W2-W6 | |
| W8 | Documentation & CDRLs | CM Plan, Test Scripts, runbooks | Ongoing | |
| W9 | Cutover & go-live | Production deployment, DNS, monitoring | W2-W8 | |
| W10 | Knowledge transfer & burn-in | Handoff to ops, monitoring period | W9 | |

Add or remove workstreams based on the actual codebase. Not all apply to every migration.

---

## Phase 3: Sprint Plan

### C1 Sprint Model (when targeting Cloud One)

Align to the official C1 schedule template:

| Sprint | Name | Duration | Focus |
|--------|------|----------|-------|
| **Sprint 0** | Setup & Onboarding | 2 weeks | C1 account provisioning, VPC deployment, FAMs access, tooling setup, team onboarding |
| **Sprint 1–2** | Foundation | 4 weeks | Infrastructure as Code, CI/CD pipeline, base container images, database provisioning |
| **Sprint 3–4** | Refactor | 4 weeks | Port 443 remediation, auth/SSO integration, interface partner coordination, application containerization |
| **Sprint 5** | Integration | 2 weeks | End-to-end integration in Dev environment, interface testing with partners |
| **Sprint 6–7** | Test | 4 weeks | Functional testing, regression, security/STIG scan, performance testing |
| **Sprint 8** | UAT & Pre-Production | 2 weeks | User acceptance testing, pre-prod deployment, go/no-go decision |
| **Sprint 9** | Production Cutover | 2 weeks | Production deployment, DNS cutover, monitoring standup, rollback readiness |
| **Sprint 10–11** | Burn-in & KT | 4 weeks | Production monitoring, defect triage, knowledge transfer to operations, documentation finalization |

### Non-C1 Sprint Model

For general cloud migrations, use a similar structure but without C1-specific gates:

| Phase | Duration | Focus |
|-------|----------|-------|
| **Phase 1: Foundation** | 2–4 weeks | IaC, CI/CD, base images, database provisioning |
| **Phase 2: Migration** | 4–6 weeks | Application migration, data migration, auth integration |
| **Phase 3: Validation** | 2–4 weeks | Testing, security scan, performance validation |
| **Phase 4: Go-Live** | 1–2 weeks | Production deployment, monitoring, rollback readiness |
| **Phase 5: Stabilization** | 2–4 weeks | Burn-in, defect triage, knowledge transfer |

### Per-Sprint Detail

For each sprint, document:

| Field | Content |
|-------|---------|
| **Sprint** | Sprint number and name |
| **Duration** | Start/end (relative, e.g., "Weeks 1–2") |
| **Objective** | One sentence — what "done" looks like for this sprint |
| **Workstreams** | Which workstream IDs (W1, W2, etc.) are active |
| **Key Tasks** | Numbered task list — specific enough to create tickets from |
| **Deliverables** | What is produced (code, config, document, report) |
| **CDRL Milestones** | *(C1 only)* Which CDRLs are due or in-progress |
| **Dependencies** | What must be complete before this sprint starts |
| **Risks** | Sprint-specific risks and mitigations |
| **Go/No-Go Criteria** | What must be true to proceed to the next sprint |

---

## Phase 4: Team & Roles

### Role Matrix

| Role | Responsibility | Estimated Hours | Sprints Active |
|------|---------------|-----------------|----------------|
| Technical Lead | Architecture decisions, blocker resolution | | All |
| Cloud Engineer | IaC, CSP account config, networking | | 0–2 |
| Application Developer | Code changes, containerization, auth integration | | 1–7 |
| DevOps Engineer | CI/CD pipeline, deployment automation | | 1–9 |
| Database Engineer | Schema migration, data transfer, validation | | 1–5 |
| QA/Test Engineer | Test planning, execution, regression | | 5–8 |
| Security Engineer | STIG scans, vulnerability remediation | | 5–8 |
| Project Manager | Schedule, risk tracking, C1 coordination | | All |

Adjust roles based on the actual migration complexity. Small migrations may combine roles.

---

## Phase 5: Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|----|------|-----------|--------|-----------|-------|
| R1 | Interface partner not ready for C1 | High | Critical | Start partner coordination in Sprint 0 | PM |
| R2 | STIG scan produces blocking findings | Medium | High | Run scan early in Sprint 5, not Sprint 7 | Security |
| R3 | Data migration takes longer than estimated | Medium | High | Pilot migration in Sprint 2 with subset | DB Engineer |
| R4 | Auth/SSO integration more complex than expected | Medium | High | Prototype GCDS integration in Sprint 1 | App Dev |

Populate with risks specific to the codebase findings.

---

## Phase 6: Write the Implementation Plan

**Filename:** Before writing, check whether `migration-plan.md` already exists in the target directory. If it does, use `migration-plan-2.md`; if that exists too, use `migration-plan-3.md`, and so on — never overwrite an existing file.

Write the implementation plan (using the resolved filename above) with:

- **Executive Summary** — migration approach, target platform, total estimated duration, total estimated effort (hours)
- **Workstream Inventory** — full table from Phase 2
- **Sprint Plan** — all sprints with per-sprint detail tables
- **Dependency Diagram** — Mermaid `gantt` or `graph LR` showing sprint/workstream dependencies
- **Team & Roles** — role matrix with hour estimates
- **Risk Register** — all identified risks with mitigations
- **CDRL Schedule** *(C1 only)* — table showing which CDRLs are due in which sprint
- **Go/No-Go Checklist** — final checklist for production cutover approval

**File paths**: use forward slashes in all tool call `filePath` arguments, even on Windows. Use relative paths from the project root, not absolute Windows paths.

After writing the file, confirm:
- The file path where the plan was written (include the resolved filename)
- Total estimated duration (weeks)
- Total estimated effort (hours)
- Number of sprints
- Top 3 risks
- Any gaps where the plan had to make assumptions (missing architecture doc, unknown interface partners, etc.)
