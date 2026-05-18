---
description: "Interactive migration assessment — conversational entry point that guides you through codebase analysis and deliverable selection"
---

## Step 1: Gather Context

Before doing any analysis, ask the user the following questions using the `question` tool. Do NOT proceed until all answers are collected.

**Question 1 — Codebase Path:**
> What codebase should I analyze? Provide the path to the project root.
>
> *(If blank, use the current working directory.)*

**Question 2 — Target Platform:**
> What is the target deployment platform?
>
> Options:
> - **Cloud One (C1)** — DoD-managed cloud broker (load the `anr-csp-knowledge` skill immediately)
> - **AWS GovCloud** — direct AWS GovCloud account
> - **Azure Government** — direct Azure Government account
> - **General cloud migration** — no specific restricted platform

**Question 3 — Deliverables:**
> Which deliverables do you want? *(Select all that apply.)*
>
> - **Migration Report** — scored assessment with risks, blockers, and recommended approach (HTML)
> - **Architecture Diagram** — C4-style diagrams with component and interface inventories (Markdown)
> - **Dependency Audit** — CVE, EOL, license, and supply-chain analysis (HTML)
> - **Cost Estimate** — compute/storage sizing and labor estimate per environment
> - **Implementation Plan** — sprint-by-sprint migration execution plan
> - **All of the above**

---

## Step 2: Load Domain Knowledge

If the target platform is **Cloud One** or any DoD/Government restricted platform:
- Load the `anr-csp-knowledge` skill immediately
- All subsequent deliverables inherit C1 constraints (port 443, GCDS/SAML, service catalog, VPC guardrails)
- Inform the user: *"C1 target detected — loading Cloud One domain expertise. All deliverables will be scored and structured against C1 requirements."*

---

## Step 3: Execute Selected Deliverables

Run the selected deliverables **in this order** (each builds on the previous):

1. **Architecture Diagram** (if selected) — run `/arch-diagram [path]`
2. **Dependency Audit** (if selected) — run `/dependency-audit [path]`
3. **Migration Report** (if selected) — run `/migration-report [path]`
4. **Cost Estimate** (if selected) — run `/cost-estimate [path]`
5. **Implementation Plan** (if selected) — run `/migration-implement [path]`

### Truth-Teller Verification Gate

**MANDATORY:** After the Migration Report findings are produced (Phase 2 scoring) but **before** the HTML report is written, run the Truth-Teller Consensus:

```
# Launch ALL THREE Truth-Tellers in PARALLEL
@truth_teller_sonnet: Review these migration findings for [codebase]. Challenge the scores, flag any missed risks, and identify any findings that seem incorrect or overstated. Here are the findings: [paste Phase 2 scores and key findings]

@truth_teller_nova: [same prompt]

@truth_teller_lite: [same prompt]
```

After all three respond, synthesize their feedback:

1. **Points of Agreement** — findings all three confirmed → high confidence, proceed as-is
2. **Points of Disagreement** — present to the user with both sides before finalizing
3. **Missed Risks** — any risk flagged by even one Truth-Teller gets added to the report
4. **Corrections** — any factual error caught by any Truth-Teller is corrected before writing

Present the consensus summary to the user:
> *"Three independent AI models reviewed the assessment. Here's where they agreed, disagreed, and what they caught that the initial analysis missed."*

Only after the user confirms → write the final report.

---

## Step 4: Summary

After all deliverables are complete, present a summary:

```markdown
## Assessment Complete

**Codebase:** [path]
**Target Platform:** [platform]
**Deliverables produced:**
- [list each file written with its path]

**Key Findings:**
- Overall migration score: [X/10]
- Recommended approach: [approach]
- Top 3 risks: [list]
- Estimated effort: [if cost-estimate was run]

**Truth-Teller Consensus:** [1-sentence summary of what the verification gate caught or confirmed]
```
