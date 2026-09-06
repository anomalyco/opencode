# C-Suite Integration Matrix

> Single source of truth for all cross-domain C-Suite integrations. Eliminates bidirectional duplication across skills.

This matrix documents all integration relationships between C-Suite orchestrators, functional business skills, and engineering skills. Each relationship is defined once with bidirectional implications.

---

## Matrix Overview

**5 C-Suite Orchestrators:**
- **chief-exec** (CEO) - Strategic alignment, cross-C-suite coordination
- **chief-tech** (CTO) - Technology governance, architecture, platform
- **chief-finance** (CFO) - Financial modeling, cash management, controls
- **chief-people** (CHRO) - Organizational design, hiring, compensation, culture
- **chief-ops** (COO) - Operational excellence, process design, delivery

**Primary Integration Types:**
1. **Governance** - Who approves what
2. **Artifact Flow** - Which artifacts inform/constrain others
3. **Escalation** - When conflicts escalate between domains
4. **Metrics** - Which KPIs feed into which dashboards

---

## C-Suite ↔ C-Suite Integrations

### CEO ↔ All C-Suite

**Relationship:** CEO is apex orchestrator; all C-suite report to CEO

| Partner | Governance | Artifacts | Escalation Trigger |
|---|---|---|---|
| **chief-tech** | Tech strategy aligns to VIS-XXXX; major ADRs escalate | TS-XXXX, ADR-XXXX, DORA → EXEC_DASHBOARD | Architecture decisions >$50K or >1 quarter timeline |
| **chief-finance** | Financial health core to CEO; fundraising jointly governed | FM-XXXX, BFN-XXXX, CASH-XXXX → EXEC_DASHBOARD | Runway <6 months, major spend >$25K |
| **chief-people** | Org design reflects strategy; culture reinforces vision | ORG-XXXX, CULT-XXXX, hiring pipeline → EXEC_DASHBOARD | Org changes affecting >10 people, executive hires, attrition >15% |
| **chief-ops** | Operational health feeds dashboard; scaling readiness gates | PROC-XXXX, DEL-XXXX, delivery metrics → EXEC_DASHBOARD | Sprint completion <70% for >2 sprints, scaling decisions |

**Key Patterns:**
- **Executive Dashboard (EXEC_DASHBOARD.md)** aggregates health from all C-suite domains
- **Executive Gate 0** approves cross-domain strategic alignment before cascading
- **Crisis Management (CRI-XXXX)** may involve any C-suite domain; CEO coordinates
- **Board Relations (BRD-XXXX)** are CEO-led with C-suite domain summaries

---

### CTO ↔ CFO

**Relationship:** Bidirectional - Infrastructure cost governance, build-vs-buy budget impact

**Integration Points:**
- **Cost Tracking:** PLT-XXXX (infrastructure, platform) → FIN-XXXX (budget line items)
- **Build-vs-Buy:** ADR-XXXX (technical decision) ↔ FM-XXXX (cost model), CTRL-XXXX (approval)
- **Tech Debt Paydown:** TD-XXXX (effort estimate) → FIN-XXXX (capacity investment)
- **Vendor Management:** VENDOR-XXXX (tech vendors) jointly reviewed by CTO + CFO

**Escalation Triggers:**
- Infrastructure cost >15% budget variance → CFO review
- Build-vs-buy decision >$25K → CFO approval required
- Tech debt paydown requiring >20% capacity → CFO capacity allocation approval

**Decision Protocol:**
- CTO proposes technical approach (ADR-XXXX)
- CFO models financial impact (FM-XXXX)
- Joint decision if budget impact significant
- CEO arbitrates if strategic conflict

---

### CTO ↔ CHRO

**Relationship:** Bidirectional - Engineering org aligns with architecture, skills inform decisions

**Integration Points:**
- **Org Topology:** ORG-XXXX (engineering teams) must align with ADR-XXXX (system architecture)
  - *Pattern:* Team topology (stream-aligned, platform, etc.) mirrors technical architecture
- **Skills Matrix:** TAL-XXXX (engineering competencies) informs ADR-XXXX (build-vs-buy, adoption)
  - *Example:* No Go expertise → Buy vendor solution vs Build
- **Hiring Needs:** TD-XXXX (tech debt), PLT-XXXX (platform gaps) → HIRE-XXXX (capacity gaps)
- **Compensation:** COMP-XXXX (engineering bands) must support competitive tech hiring

**Escalation Triggers:**
- Org structure change affecting >5 engineers → Joint CTO + CHRO review
- Skills gap blocking critical PORT-XXXX → Joint hiring plan
- Tech debt requiring dedicated team (>3 people) → CHRO hiring pipeline

**Conway's Law Adherence:**
- If system architecture changes (ADR-XXXX), org structure may need update (ORG-XXXX)
- If org structure changes, consider technical architecture alignment

---

### CTO ↔ COO

**Relationship:** Bidirectional - Delivery metrics jointly owned, release cadence coordinated

**Integration Points:**
- **DORA Metrics:** Jointly owned KPIs (deploy frequency, lead time, MTTR, change failure rate)
  - CTO owns technical enablement (CI/CD, PLT-XXXX)
  - COO owns process governance (DEL-XXXX, sprint cadence)
- **Release Cadence:** DEL-XXXX (delivery governance) ↔ release-manager coordination
- **Process Automation:** COO identifies high-frequency, high-error-rate PROC-XXXX → CTO implements automation
- **Platform Decisions:** PLT-XXXX (infrastructure, tooling) affects PROC-XXXX (operational processes)

**Escalation Triggers:**
- DORA metrics declining >2 sprints → Joint review (technical vs process cause)
- Deployment process issues (PROC-XXXX) blocking releases → Joint resolution
- Platform changes affecting >3 operational processes → Joint impact assessment

**Collaboration Pattern:**
- COO surfaces operational friction (PROC-XXXX cycle time, error rate)
- CTO evaluates technical solution (automation, tooling, PLT-XXXX)
- Joint decision on build priority

---

### CFO ↔ CHRO

**Relationship:** Bidirectional - Compensation aligns with financial model, headcount is largest OpEx

**Integration Points:**
- **Compensation Framework:** COMP-XXXX must align with FM-XXXX (financial model affordability)
- **Headcount Planning:** HIRE-XXXX (hiring pipeline) is largest OpEx line in FIN-XXXX
- **Equity Grants:** COMP-XXXX (equity offers) require CFO approval (dilution analysis in FM-XXXX)
- **Benefits Cost:** COMP-XXXX (benefits package) → FIN-XXXX (loaded cost per employee)

**Escalation Triggers:**
- Compensation band changes affecting >5% total OpEx → CFO approval
- Hiring plan exceeding FM-XXXX headcount forecast → Joint reforecast
- Equity grant pool depletion → CFO dilution analysis for refresh

**Financial Constraint Flow:**
- CFO sets total people budget (FM-XXXX, FIN-XXXX)
- CHRO allocates within budget (HIRE-XXXX prioritization, COMP-XXXX bands)
- Exceptions escalate to CEO (Executive Gate 0)

---

### CFO ↔ COO

**Relationship:** Bidirectional - Operational efficiency impacts burn rate, vendor cost jointly managed

**Integration Points:**
- **Operational Efficiency:** PROC-XXXX optimization directly reduces burn rate (CASH-XXXX)
- **Vendor Cost Management:** VENDOR-XXXX cost tracking (business-operations) → FIN-XXXX
  - COO escalates SLA breaches
  - CFO escalates cost overruns >20%
- **Resource Allocation:** Resource arbitration decisions affect FIN-XXXX budget utilization
- **OKR Budgeting:** OKR-XXXX initiatives have FIN-XXXX budget implications

**Escalation Triggers:**
- Vendor cost escalation >20% → CFO contract renegotiation or replacement
- Operational spend variance >15% → Joint review (efficiency vs budget accuracy)
- Process optimization requiring investment → CFO ROI analysis

**Cost Optimization Pattern:**
- COO identifies process inefficiency (PROC-XXXX cycle time, waste)
- CFO quantifies financial impact (burn rate reduction potential)
- Joint prioritization of optimization efforts

---

### CHRO ↔ COO

**Relationship:** Bidirectional - Team capacity feeds resource planning, utilization informs hiring

**Integration Points:**
- **Capacity Planning:** ORG-XXXX (team capacity) → DEL-XXXX (sprint commitments), resource arbitration
- **Utilization Data:** Utilization >90% sustained → CHRO hiring trigger (HIRE-XXXX)
- **Onboarding Playbooks:** PLAY-XXXX (onboarding) jointly owned (CHRO policy, COO execution)
- **Org Changes:** ORG-XXXX restructuring requires PROC-XXXX (process) updates

**Escalation Triggers:**
- Team utilization >90% for >1 quarter → CHRO emergency hiring
- Utilization <60% sustained → Joint review (org structure vs workload)
- Onboarding NPS <7 → Joint playbook improvement (CHRO + COO)

**Capacity Management Loop:**
1. COO monitors utilization (DEL-XXXX, resource arbitration)
2. High utilization → CHRO hiring pipeline (HIRE-XXXX)
3. Low utilization → Joint review (strategic pivot? process efficiency?)

---

## C-Suite ↔ Functional Business Skills

### CEO + CFO ↔ venture-strategist

**Relationship:** CEO governs strategy execution; CFO governs fundraising execution; strategist produces artifacts

**Integration Points:**
- **Strategy Production:** venture-strategist produces VIS-XXXX, BM-XXXX, PORT-XXXX
- **Execution Governance:** CEO ensures strategy execution across C-suite
- **Fundraising:** venture-strategist manages INV-XXXX pipeline; CFO governs terms (FM-XXXX dilution analysis)
- **Portfolio Priority:** PORT-XXXX ranking is CEO + strategist joint decision; cascades to all C-suite

**Artifact Flow:**
- VIS-XXXX (vision) → All C-suite align strategies
- PORT-XXXX (portfolio) → Resource allocation across CTO, CHRO, COO
- INV-XXXX (investor pipeline) → CFO fundraising governance
- BM-XXXX (business model) → CFO financial modeling (FM-XXXX)

**Escalation:** Portfolio conflicts (PORT-XXXX priority disputes) escalate to CEO

---

### CTO ↔ rd-innovator

**Relationship:** CTO governs technology adoption; rd-innovator scouts and prototypes

**Integration Points:**
- **Technology Radar:** rd-innovator produces TECH-XXXX (Assess/Trial rings)
- **Adoption Governance:** CTO approves TECH-XXXX ring transitions (Trial → Adopt via ADR-XXXX)
- **Prototype Validation:** PROTO-XXXX must validate against TS-XXXX (tech strategy principles)
- **Transfer Packages:** rd-innovator transfer packages → build-agent (CTO validates readiness)

**Decision Flow:**
1. rd-innovator scouts technology (TECH-XXXX: Assess)
2. rd-innovator builds prototype (PROTO-XXXX: Trial)
3. CTO evaluates against TS-XXXX principles
4. CTO approves adoption (ADR-XXXX) or moves to Hold

**Escalation:** Technology adoption with >$50K cost or >1 quarter timeline → CEO (Executive Gate 0)

---

### COO + CFO ↔ business-operations

**Relationship:** COO and CFO set policy; business-operations executes tracking

**Integration Points:**
- **Financial Tracking:** business-operations executes FIN-XXXX budget tracking per CFO's CTRL-XXXX controls
- **OKR Monitoring:** business-operations tracks OKR-XXXX progress; COO governs delivery
- **Vendor Management:** business-operations tracks VENDOR-XXXX; Tier 2+ escalations → COO
- **Operational Metrics:** business-operations tracks OPS-XXXX; COO governs PROC-XXXX processes

**Escalation Patterns:**
- **To CFO:** Budget variance >15%, spend approval exceptions (CTRL-XXXX)
- **To COO:** Vendor SLA breaches (Tier 2+), process issues, OKR off-track

**Governance Model:**
- CFO: Financial policy (FM-XXXX, CTRL-XXXX)
- COO: Operational policy (PROC-XXXX, PLAY-XXXX, DEL-XXXX)
- business-operations: Execution layer (tracking, reporting, escalation)

---

### COO ↔ gtm-executor

**Relationship:** COO governs launch execution; gtm-executor manages marketing/growth

**Integration Points:**
- **Launch Coordination:** PLAY-XXXX (launch playbook) connects gtm-executor + release-manager
- **Marketing Cadence:** Marketing campaigns align with product release cadence (DEL-XXXX)
- **Growth Experiments:** GROW-XXXX execution is operational process (COO ensures methodology)
- **Channel Budget:** CHAN-XXXX budget governed by CFO's CTRL-XXXX; execution visibility to COO

**Collaboration Pattern:**
- gtm-executor plans launch (MKT-XXXX, GTM-XXXX)
- COO coordinates cross-functional execution (PLAY-XXXX)
- release-manager handles engineering deployment
- Trio synchronization: gtm + release + ops

**Escalation:** Launch coordination issues (misalignment, delays) → COO arbitration

---

### CFO + COO ↔ gtm-executor

**Relationship:** CFO governs marketing budget; COO governs execution; gtm-executor manages campaigns

**Integration Points:**
- **Marketing Budget:** CFO CTRL-XXXX approval matrix → gtm-executor MKT-XXXX spending
- **Unit Economics:** gtm-executor owns CAC, LTV data (GROW-XXXX) → CFO monitors (FM-XXXX thresholds)
- **Channel ROI:** CHAN-XXXX performance → CFO budget allocation decisions
- **Campaign Execution:** MKT-XXXX campaigns follow COO's PROC-XXXX (process governance)

**Dual Escalation:**
- **To CFO:** CAC >target, LTV:CAC <3:1, channel budget overrun
- **To COO:** Campaign execution issues, cross-functional coordination failures

---

## C-Suite ↔ Engineering Skills

### CTO ↔ Engineering Pipeline

**Relationship:** CTO governs engineering standards and architecture; engineering skills execute

**Integration Points:**
- **requirement-architect:** ADR-XXXX (accepted) become technical constraints in REQUIREMENTS.md
- **logic-gatekeeper:** Validates requirements against ADR-XXXX (feasibility)
- **build-agent:** Engineering standards (from CTO) govern code generation; ADR-XXXX are build constraints
- **test-designer:** Test standards and coverage targets from CTO
- **red-team-verifier:** Verification results reveal tech debt (TD-XXXX), security gaps, architecture violations
- **release-manager:** Release cadence governed by COO's DEL-XXXX; CTO provides platform (PLT-XXXX)
- **observability-planner:** Platform observability (PLT-XXXX) aligns with MET-XXXX definitions; SLOs validate ADR-XXXX

**Governance Flow:**
- CTO sets: TS-XXXX (principles), ADR-XXXX (architecture), engineering standards
- Engineering skills: Execute within constraints
- Feedback: red-team-verifier findings → TD-XXXX, observability metrics → ADR-XXXX validation

**Escalation:** Engineering pipeline blocked by architecture constraints → CTO reviews ADR-XXXX

---

### COO ↔ Engineering Pipeline

**Relationship:** COO governs delivery cadence and process; engineering executes

**Integration Points:**
- **agile-v-product-owner:** Sprint cadence and capacity governed by COO's DEL-XXXX framework
- **release-manager:** Release cadence documented and predictable (DEL-XXXX); exceptions require COO coordination
- **Engineering metrics:** Sprint velocity, completion rate feed COO's DELIVERY_DASHBOARD (DEL-XXXX)

**Coordination Pattern:**
- COO sets: DEL-XXXX (cadences), PROC-XXXX (development workflow)
- product-owner: Executes sprint planning within framework
- release-manager: Executes releases within cadence
- Cross-team dependencies tracked by product-owner → COO arbitration if >3/sprint

**Escalation:** Sprint completion <85% for >2 sprints → COO + CTO joint review (process vs technical cause)

---

### CFO ↔ Engineering (Cost Visibility)

**Relationship:** CFO tracks infrastructure and engineering cost

**Integration Points:**
- **Infrastructure Cost:** chief-tech PLT-XXXX (infrastructure) → CFO FIN-XXXX (significant OpEx line)
- **Engineering Headcount:** chief-people HIRE-XXXX (engineering hires) → CFO FM-XXXX (largest cost center)
- **Build-vs-Buy:** chief-tech ADR-XXXX decisions have direct budget impact (CFO models in FM-XXXX)

**Cost Tracking:**
- CTO owns PLT-XXXX (platform cost, infrastructure)
- CFO tracks cost in FIN-XXXX
- Variance >15% → Joint CTO + CFO review

---

### CHRO ↔ Engineering (Capacity & Skills)

**Relationship:** CHRO manages engineering org and skills; informs sprint capacity

**Integration Points:**
- **Skills Matrix:** TAL-XXXX (engineering competencies) informs sprint capacity (product-owner)
- **Org Structure:** ORG-XXXX (engineering teams) → product-owner (team assignments)
- **Hiring Pipeline:** HIRE-XXXX (engineering roles) fills capacity gaps surfaced by product-owner velocity trends

**Capacity Flow:**
1. product-owner tracks velocity (DEL-XXXX)
2. Declining velocity → CHRO reviews TAL-XXXX (skills gap?) and ORG-XXXX (org structure?)
3. Sustained low velocity with high utilization → HIRE-XXXX (add capacity)

---

### CEO ↔ Engineering (Visibility Only)

**Relationship:** CEO has visibility to engineering health via CTO and COO dashboards

**Integration Points:**
- **Engineering Health:** CTO dashboard (DORA metrics, tech debt, security) → EXEC_DASHBOARD
- **Delivery Health:** COO dashboard (sprint completion, velocity, releases) → EXEC_DASHBOARD
- **Human Gates:** Engineering Human Gate 1 and 2 are separate from Executive Gates (business)

**Escalation:** Engineering health red for >1 month → CEO intervenes (CTO + COO coordination)

---

## C-Suite ↔ Compliance & Documentation

### All C-Suite ↔ compliance-auditor

**Relationship:** compliance-auditor observes all C-suite artifacts for traceability and compliance

**Integration Points:**
- **Decision Logging:** All C-suite decision logs (EXEC-XXXX, ADR-XXXX, FM-XXXX, ORG-XXXX, PLAY-XXXX) feed audit trail
- **Risk Register:** RISK_REGISTER.md aggregates risks from all domains
- **CAPA Log:** CAPA_LOG.md tracks corrective/preventive actions across all domains
- **Traceability Matrix:** All artifacts trace to requirements (engineering) or strategic goals (business)

**Escalation:** CRITICAL CAPA open >48 hours → CEO notification

---

### CEO ↔ documentation-agent

**Relationship:** documentation-agent generates standards-based repo docs per CEO direction

**Integration Points:**
- **Repository Documentation:** documentation-agent reads all C-suite artifacts to generate docs/
- **ISO 9001 Coverage:** Documents quality management system (all C-suite decision processes)
- **Traceability:** Links business artifacts to engineering artifacts

**Trigger:** CEO or CTO requests documentation generation (typically at milestones, fundraising, audits)

---

## Integration Patterns Summary

### Common Patterns Across Integrations

**1. Escalation Tiers (from c-suite-foundation):**
- Tier 1: Team/functional leads negotiate
- Tier 2: Domain C-suite officer (CTO, CFO, CHRO, COO)
- Tier 3: CEO (cross-domain conflicts)
- Tier 4: Board (if CEO cannot resolve or strategic pivot)

**2. Artifact Flow:**
- **Downstream:** Higher-level artifacts constrain lower-level (VIS-XXXX → TS-XXXX → ADR-XXXX → REQ-XXXX)
- **Upstream:** Metrics and feedback flow up (MET-XXXX → DORA → CTO dashboard → EXEC_DASHBOARD)

**3. Decision Authority:**
- **Single Domain:** Domain C-suite officer decides
- **Cross-Domain with Budget Impact:** CFO involved
- **Cross-Domain Strategic:** CEO decides (Executive Gate 0)

**4. Gate Coordination:**
- **Engineering Gates (Human Gate 1, 2):** Technical validation points
- **Business Gates (Business Gate 0, 1, 2):** Strategic/financial validation points
- **Executive Gate 0:** Cross-domain strategic alignment (CEO-led)
- Gates are independent but coordinated (e.g., can't release without both engineering Gate 2 AND business clearance)

---

## Usage Notes

**For Skill Authors:**
- When documenting integrations in a C-Suite skill, reference this matrix
- Format: "See c-suite-foundation/INTEGRATION_MATRIX.md for complete mappings"
- Add only domain-specific integration details in the skill itself

**For Agents:**
- Load this matrix when coordinating across multiple C-suite domains
- Use escalation tiers to determine who resolves conflicts
- Follow artifact flow to understand dependencies

**Maintenance:**
- This matrix is the single source of truth for C-suite integrations
- Update this file when integration relationships change
- Version control tracks evolution of integration patterns

---

**Last Updated:** 2026-04-19  
**Version:** 1.0  
**Status:** Active
