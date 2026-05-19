# Document Review Output Template

Use this **exact format** when presenting synthesized review findings in Interactive mode. Findings are grouped by severity, not by reviewer.

**IMPORTANT:** Use pipe-delimited markdown tables (`| col | col |`). Do NOT use ASCII box-drawing characters.

**IMPORTANT:** Escape literal pipe characters in table cells. Any `|` that appears inside a finding's section reference, issue description, code snippet, regex pattern, or delimited-string example must be written as `\|` so column boundaries are determined only by unescaped pipes. Unescaped pipes split the cell across columns and corrupt the row's `Reviewer`, `Confidence`, and `Tier` values.

This template describes the Phase 4 interactive presentation — what the user sees before the routing question (`references/walkthrough.md`) fires. The headless-mode envelope is documented in `references/synthesis-and-presentation.md` (Phase 4 "Route Remaining Findings" section) and is separate from this template.

**Vocabulary note.** Internal enum values (`safe_auto`, `gated_auto`, `manual`, `FYI`) live in the schema and synthesis pipeline. User-facing rendered text uses plain-language labels instead: fixes (for `safe_auto`), proposed fixes (for `gated_auto`), decisions (for `manual`), and FYI observations (for `FYI`). The `Tier` column in the tables below is the one place that still names the internal enum so the user can see the synthesis decision; everything else reads as plain language.

**Confidence column.** The `Confidence` column shows the integer anchor value (`50`, `75`, or `100`) — never a decimal or percentage. Anchor `50` = advisory (routed to FYI); anchor `75` = verified, will hit in practice; anchor `100` = certain, evidence directly confirms. Anchors `0` and `25` are dropped by synthesis before this layer and never appear in the rendered output. Cross-persona agreement promotes by one anchor step; when this happens, the Reviewer column notes it (e.g., `coherence, feasibility (+1 anchor)`).

## Example

```markdown
## Document Review Results

**Document:** docs/plans/2026-03-15-feat-user-auth-plan.md
**Type:** plan
**Reviewers:** coherence, feasibility, security-lens, scope-guardian
- security-lens -- plan adds public API endpoint with auth flow
- scope-guardian -- plan has 15 requirements across 3 priority levels

Applied 5 fixes. 4 items need attention (2 errors, 2 omissions). 2 FYI observations.

### Applied fixes

- Standardized "pipeline"/"workflow" terminology to "pipeline" throughout (coherence)
- Fixed cross-reference: Section 4 referenced "Section 3.2" which is actually "Section 3.1" (coherence)
- Updated unit count from "6 units" to "7 units" to match listed units (coherence)
- Added "update API rate-limit config" step to Unit 4 -- implied by Unit 3's rate-limit introduction (feasibility)
- Added auth token refresh to test scenarios -- required by Unit 2's token expiry handling (security-lens)

### P0 — Must Fix

#### Errors

| # | Section | Issue | Reviewer | Confidence | Tier |
|---|---------|-------|----------|------------|------|
| 1 | Requirements Trace | Goal states "offline support" but technical approach assumes persistent connectivity | coherence | 100 | manual |

### P1 — Should Fix

#### Errors

| # | Section | Issue | Reviewer | Confidence | Tier |
|---|---------|-------|----------|------------|------|
| 2 | Scope Boundaries | 8 of 12 units build admin infrastructure; only 2 touch stated goal | scope-guardian | 75 | manual |

#### Omissions

| # | Section | Issue | Reviewer | Confidence | Tier |
|---|---------|-------|----------|------------|------|
| 3 | Implementation Unit 3 | Plan proposes custom auth but does not mention existing Devise setup or migration path | feasibility | 100 | gated_auto |

### P2 — Consider Fixing

#### Omissions

| # | Section | Issue | Reviewer | Confidence | Tier |
|---|---------|-------|----------|------------|------|
| 4 | API Design | Public webhook endpoint has no rate limiting mentioned | security-lens | 75 | gated_auto |

### FYI Observations

Low-confidence observations surfaced without requiring a decision. Content advisory only.

| # | Section | Observation | Reviewer | Confidence |
|---|---------|-------------|----------|------------|
| 1 | Naming | Filename `plan.md` is asymmetric with command name `user-auth`; could go either way | coherence | 50 |
| 2 | Risk Analysis | Rollout-cadence decision may benefit from monitoring thresholds, though not blocking | scope-guardian | 50 |

### Residual Concerns

Residual concerns are issues the reviewers noticed but could not confirm at confidence anchor `50` or higher. These are not actionable; they appear here for transparency only and are not promoted into the review surface.

| # | Concern | Source |
|---|---------|--------|
| 1 | Migration rollback strategy not addressed for Phase 2 data changes | feasibility |

### Deferred Questions

| # | Question | Source |
|---|---------|--------|
| 1 | Should the API use versioned endpoints from launch? | feasibility, security-lens |

### Coverage

| Persona | Status | Findings | Auto | Proposed | Decisions | FYI | Residual |
|---------|--------|----------|------|----------|-----------|-----|----------|
| coherence | completed | 5 | 3 | 0 | 1 | 1 | 0 |
| feasibility | completed | 3 | 1 | 1 | 0 | 0 | 1 |
| security-lens | completed | 2 | 1 | 1 | 0 | 0 | 0 |
| scope-guardian | completed | 2 | 0 | 0 | 1 | 1 | 0 |
| product-lens | not activated | -- | -- | -- | -- | -- | -- |
| design-lens | not activated | -- | -- | -- | -- | -- | -- |

Dropped: 3 (anchors 0/25 suppressed)
Chains: 1 root with 2 dependents
Restated: 2 (residual/deferred items suppressed as duplicates of actionable findings)
```

## Section Rules

- **Summary line**: Always present after the reviewer list. Format: "Applied N fixes. K items need attention (X errors, Y omissions). Z FYI observations." Omit any zero clause except the FYI clause when zero (it's informative that none surfaced).
- **Applied fixes**: List all fixes that were applied automatically (`safe_auto` tier). Include enough detail per fix to convey the substance — especially for fixes that add content or touch document meaning. Omit section if none.
- **P0-P3 sections**: Only include sections that have actionable findings (`gated_auto` or `manual`). Omit empty severity levels. Within each severity, separate into **Errors** and **Omissions** sub-headers. Omit a sub-header if that severity has none of that type. The `Tier` column surfaces whether a finding is `gated_auto` (concrete fix exists, Apply recommended in walk-through) or `manual` (requires user judgment).
- **FYI Observations**: Findings at confidence anchor `50` regardless of `autofix_class`. Surface here for transparency; these are not actionable and do not enter the walk-through. Omit section if none.
- **Residual Concerns**: Residual concerns noted by personas that did not make it above the confidence gate. Listed for transparency; not promoted into the review surface (cross-persona agreement boost runs on findings that already survived the gate, per synthesis step 3.4). Omit section if none.
- **Deferred Questions**: Questions for later workflow stages. Omit if none.
- **Compact rendering for FYI / Residual / Deferred (high-count mode)**: When the combined count across these three sections is **5 or more**, collapse each section to a one-line summary followed by the items as a tight bullet list (no table, no per-item `Why` elaboration). Rationale: these sections are observational, not decision-forcing — when they are lengthy, they bury the actionable tiers above them. A P0/P1/P2 actionable finding stays fully rendered regardless of how many FYI/Residual/Deferred items exist. When the combined count is 4 or fewer, render each section as today.
- **Coverage**: Always include. All counts are **post-synthesis**. **Findings** must equal Auto + Proposed + Decisions + FYI exactly — if deduplication merged a finding across personas, attribute it to the persona with the highest confidence anchor and reduce the other persona's count. **Residual** = count of `residual_risks` from this persona's raw output (not the promoted subset in the Residual Concerns section). The `Auto` column counts `safe_auto` findings at anchor `100`, `Proposed` counts `gated_auto` findings at anchor `75` or `100`, `Decisions` counts `manual` findings at anchor `75` or `100`, and `FYI` counts findings at anchor `50` regardless of `autofix_class`. Findings at anchors `0` or `25` were dropped by synthesis and do not appear in any column. Do NOT invent additional columns (e.g., `Dropped`, `Surviving`). The column schema above is the canonical set.
- **Coverage footnote lines** (optional, appear below the table when non-zero): `Dropped: N (anchors 0/25 suppressed)` when synthesis 3.2 dropped any findings. `Chains: N root(s) with M dependents` when premise-dependency chains exist. `Restated: N (residual/deferred items suppressed as duplicates of actionable findings)` when synthesis 3.9 suppressed any restatements. These footnotes — not the summary line, not per-persona columns — are the canonical location for cross-cutting counts that don't fit the per-persona shape. Order: `Dropped:`, then `Chains:`, then `Restated:`, each on its own line. Omit any footnote whose count is zero.

## Chain-Rendering Rules

Premise-dependency chains from synthesis step 3.5c annotate roots and dependents. Rendering follows the same count invariant documented in the synthesis reference; this template restates the rules so interactive output cannot drift from the headless envelope.

- **Dependents render only under their root.** When a finding has `dependents`, render the root at its normal severity position (in its P-tier Errors or Omissions table). Immediately below the root's table row, emit an indented `Dependents (N)` sub-block listing each dependent's `# | Section | Issue | Reviewer | Confidence | Tier` entry. Dependents MUST NOT appear at their own severity position. Findings without `depends_on` and without `dependents` render as they do today.
- **Count invariant.** The `Findings` column in Coverage continues to equal Auto + Proposed + Decisions + FYI. Each finding counts exactly once: a dependent counts in its assigned bucket (`Auto` / `Proposed` / `Decisions` / `FYI`) but does NOT render at its own severity position. The source of truth is the post-Step-4 `dependents` array on each root — the same array the headless envelope reads — so coverage count and rendering cannot drift.
- **Chains line (optional).** When one or more chains exist, add a final line to the coverage block: `Chains: N root(s) with M dependents` where N is the number of roots and M is the total dependent count summed across all roots. Omit the line when no chains exist. This mirrors the `Chains:` line the headless envelope emits in `references/synthesis-and-presentation.md` so reviewers get the same chain visibility in both modes.
