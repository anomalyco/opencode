---
description: "Estimate migration cost — compute/storage sizing, CSP monthly spend, labor hours, and total cost of ownership"
---

> **If this migration targets Cloud One (C1)**, load the `anr-csp-knowledge` skill before proceeding. C1 cost estimation has unique requirements: funding must be sent to C1 as **one full year** of compute + storage costs upfront based on App Analysis estimates. Accuracy directly determines the budget — overestimate wastes funds, underestimate causes mid-year funding shortfalls. Reference `app-analysis-guide.md` for the per-environment sizing format C1 expects, and `CloudOne_DetailedSchedule_Template_Master_v1.0.csv` for role-based labor hour breakdowns.

Analyze the codebase or existing reports at: $ARGUMENTS

If no path is provided, analyze the current working directory.

## Your Task

Produce a comprehensive cost estimate covering infrastructure, labor, and total cost of ownership. Output as a self-contained HTML report.

---

## Phase 1: Discovery

Gather sizing inputs from available sources:

1. **Existing migration report** — check for `migration-report.html`. Extract: target platform, recommended approach, architecture complexity, database engine, dependency count.
2. **Architecture document** — check for `ARCHITECTURE.md`. Extract: number of services, data stores, external integrations, message infrastructure.
3. **Implementation plan** — check for `migration-plan.md`. Extract: sprint count, team composition, role hours.
4. **Source code** — if no prior reports exist, read the codebase to determine: language/runtime, database type and estimated data volume, number of services, deployment model.

---

## Phase 2: Infrastructure Cost Estimation

### Compute Sizing

For each environment, estimate compute requirements:

| Environment | Purpose | Instances | Instance Type | vCPUs | Memory (GB) | Monthly Cost |
|-------------|---------|-----------|--------------|-------|-------------|-------------|
| **Development** | Active development, debugging | | | | | |
| **Integration** | CI/CD target, integration testing | | | | | |
| **Test / Staging** | QA, UAT, performance testing | | | | | |
| **Production** | Live workload | | | | | |

**Sizing methodology:**
- Infer from the codebase: framework weight (Spring Boot = heavier than Express), database engine, expected concurrency patterns
- For containerized workloads: estimate container CPU/memory requests and map to node sizes
- For serverless: estimate invocation count, duration, and memory per function
- Default to conservative (slightly over) rather than optimistic — C1 requires upfront funding based on these estimates

### Database Sizing

| Environment | Engine | Instance Type | Storage (GB) | IOPS | Monthly Cost |
|-------------|--------|--------------|-------------|------|-------------|
| Development | | | | | |
| Integration | | | | | |
| Test | | | | | |
| Production | | | | | |

**Sizing signals from code:**
- Schema complexity (number of tables/collections from migration files or ORM models)
- Data volume hints (pagination defaults, batch sizes, archival patterns)
- Read/write ratio (query patterns in data access layer)

### Storage & Networking

| Resource | Type | Size/Throughput | Per-Environment | Monthly Cost |
|----------|------|----------------|-----------------|-------------|
| Object storage (S3/Blob) | | | | |
| Container registry | | | | |
| Load balancer | | | | |
| Data transfer (egress) | | | | |
| DNS / CDN | | | | |
| VPN / Direct Connect | | | | |

### Supporting Services

| Service | Purpose | Per-Environment | Monthly Cost |
|---------|---------|-----------------|-------------|
| Monitoring (CloudWatch / Azure Monitor) | | | |
| Logging (CloudWatch Logs / Log Analytics) | | | |
| Secrets Manager / Key Vault | | | |
| Container orchestration (EKS / AKS) | | | |
| CI/CD tooling (CodePipeline / DevOps) | | | |
| Artifactory *(C1 only)* | Artifact delivery | | |

---

## Phase 3: Labor Cost Estimation

### Migration Labor

| Role | Hourly Rate | Sprints Active | Hours/Sprint | Total Hours | Total Cost |
|------|------------|----------------|-------------|-------------|-----------|
| Technical Lead | | | | | |
| Cloud/Infrastructure Engineer | | | | | |
| Application Developer | | | | | |
| DevOps Engineer | | | | | |
| Database Engineer | | | | | |
| QA/Test Engineer | | | | | |
| Security Engineer | | | | | |
| Project Manager | | | | | |

**Rate assumptions:** Use blended contractor rates typical for DoD/Government work unless the user specifies rates. Default: $150–200/hr for senior roles, $100–150/hr for mid-level. State assumptions clearly.

### C1-Specific Labor *(when targeting Cloud One)*

Additional labor items unique to C1 migrations:

| Task | Role | Hours | Cost |
|------|------|-------|------|
| App Analysis preparation & review | Tech Lead + PM | 40–80 | |
| C1 onboarding coordination | PM | 20–40 | |
| CDRL A004 (CM Plan) | Tech Lead | 16–24 | |
| CDRL A038 (Test Scripts) | QA Engineer | 24–40 | |
| STIG scan remediation | Security Engineer | 40–80 | |
| GCDS/SSO integration | App Developer | 40–80 | |
| Interface partner coordination | PM + Tech Lead | 20–40 | |
| C1 weekly status calls | PM | 2/week ongoing | |

---

## Phase 4: Total Cost of Ownership

### One-Time Costs

| Category | Cost |
|----------|------|
| Migration labor (total) | |
| License conversions or purchases | |
| Training / certification | |
| Data migration tooling | |
| **Total one-time** | |

### Recurring Annual Costs

| Category | Year 1 | Year 3 | Year 5 |
|----------|--------|--------|--------|
| Compute (all environments) | | | |
| Database (all environments) | | | |
| Storage & networking | | | |
| Supporting services | | | |
| Operations labor (estimated) | | | |
| Licensing (annual) | | | |
| **Total annual** | | | |

### Total Cost of Ownership

| Timeframe | TCO |
|-----------|-----|
| Year 1 (migration + first year operations) | |
| 3-Year TCO | |
| 5-Year TCO | |

### C1 Funding Note *(when targeting Cloud One)*

> C1 requires **one full year of compute + storage costs** sent as upfront funding based on the App Analysis estimates. This is the "Infrastructure — Year 1" row from the table above. Under-estimating this number causes a mid-year funding shortfall that requires a supplemental funding request and may stall the migration. Over-estimating is less risky but ties up program funds. Target **+15–20% buffer** over the calculated estimate.

---

## Phase 5: Write the Cost Estimate Report

**Filename:** Before writing, check whether `cost-estimate.html` already exists in the target directory. If it does, use `cost-estimate-2.html`; if that exists too, use `cost-estimate-3.html`, and so on — never overwrite an existing file.

Write a self-contained HTML file (using the resolved filename above) with:

- **Executive Summary** — total migration cost, annual run cost, 3-year TCO, CSP recommendation, highest cost driver
- **Infrastructure Cost Breakdown** — per-environment tables for compute, database, storage, supporting services
- **Labor Cost Breakdown** — role-by-role table with hours and costs; C1-specific labor section if applicable
- **TCO Summary** — 1/3/5 year view with a simple bar chart (CSS-only)
- **Assumptions & Caveats** — every assumption made (hourly rates, instance sizing rationale, growth projections)
- **Cost Optimization Opportunities** — reserved instances, savings plans, right-sizing, spot instances, serverless conversion candidates

Use this color scheme:
- Background: `#0f172a`, Cards: `#1e293b`, Text: `#e2e8f0`, Accent: `#38bdf8`
- Cost highlights: High cost items in `#f97316`, savings opportunities in `#22c55e`

**File paths**: use forward slashes in all tool call `filePath` arguments, even on Windows. Use relative paths from the project root, not absolute Windows paths.

After writing the file, confirm:
- The file path where the report was written (include the resolved filename)
- Total one-time migration cost
- Annual infrastructure run cost
- 3-year TCO
- Top cost driver
- Key assumptions that most affect accuracy
