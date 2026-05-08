# Phases 3-5: Synthesis, Presentation, and Next Action

## Phase 3: Synthesize Findings

Process findings from all agents through this pipeline. Order matters — each step depends on the previous. The pipeline implements the finding-lifecycle state machine: **Raised → (Confidence Gate | FYI-eligible | Dropped) → Deduplicated → Classified → SafeAuto | GatedAuto | Manual | FYI**. Re-evaluate state at each step boundary; do not carry forward assumptions from earlier steps as prose-level shortcuts.

### 3.1 Validate

Check each agent's returned JSON against the findings schema:

- Drop findings missing any required field defined in the schema
- Drop findings with invalid enum values (including the pre-rename `auto` / `present` values from older personas — treat those as malformed until all persona output has been regenerated)
- Note the agent name for any malformed output in the Coverage section

**Do not narrate remap / validation diagnostics to the user.** Schema-drift notes ("persona X returned unknown enum Y, remapped to Z"), persona-prompt-drift commentary, and other validator-internal diagnostics are maintainer-facing information. They do not belong in the Phase 4 output the user reads. If a persona's output is malformed, the only user-visible consequence is a Coverage-row annotation (e.g., the persona shows fewer findings or a `malformed` marker). Everything else stays internal.

### 3.2 Confidence Gate (Anchor-Based)

Gate findings by their `confidence` anchor value. Anchors are discrete integers (`0`, `25`, `50`, `75`, `100`) with behavioral definitions documented in `references/findings-schema.json` and embedded in the persona rubric (`references/subagent-template.md`). This replaces the prior continuous 0.0-1.0 scale with per-severity gates — doc-review economics do not warrant threshold gradation by severity, and coarse anchors prevent false-precision gaming.

| Anchor | Meaning | Route |
|--------|---------|-------|
| `0`    | False positive or pre-existing issue | Drop silently |
| `25`   | Might be real but could not verify | Drop silently |
| `50`   | Verified real but nitpick / advisory / not very important | Surface in FYI subsection |
| `75`   | Double-checked, will hit in practice, directly impacts correctness | Enter actionable tier (classify by `autofix_class`) |
| `100`  | Evidence directly confirms; will happen frequently | Enter actionable tier (classify by `autofix_class`) |

- **Dropped silently** (anchors `0` and `25`): these do not surface in any output bucket — not as findings, not as FYI observations, not as residual concerns. Record the total drop count as a Coverage footnote line when non-zero: `Dropped: N (anchors 0/25 suppressed)`. The footnote appears below the Coverage table, alongside the `Chains:` footnote when both apply. This is the canonical location for drop-count reporting — not the summary line and not a per-persona Coverage column. Omit the footnote when N is zero.
- **FYI-subsection** (anchor `50`): surface in the presentation layer's FYI subsection regardless of `autofix_class`. These do not enter the walk-through or any bulk action — observational value without forcing a decision. Advisory observations ("nothing breaks, but...") naturally land here.
- **Actionable** (anchors `75` and `100`): enter the classification pipeline. Route by `autofix_class` (see 3.7).

**Why this threshold, not Anthropic's ≥ 80 code-review threshold:** Document review has opposite economics from code review. There is no linter backstop — the review IS the backstop. Premise-level concerns (product-lens, adversarial) naturally cap at anchors 50-75 because "is the motivation valid?" cannot be verified against ground truth. The routing menu already makes dismissal cheap (Skip, Append to Open Questions), so surfaced-and-skipped is a low-cost outcome while missed-and-shipped derails downstream implementation. Filter low (`≥ 50`) and let the routing menu handle volume.

### 3.3 Deduplicate

Fingerprint each finding using `normalize(section) + normalize(title)`. Normalization: lowercase, strip punctuation, collapse whitespace.

When fingerprints match across personas:

- If the findings recommend opposing actions (e.g., one says cut, the other says keep), do not merge — preserve both for contradiction resolution in 3.5
- Otherwise merge: keep the highest severity, keep the highest confidence anchor (if tied, keep the finding appearing first in document order — deterministic, not probabilistic), union all evidence arrays, note all agreeing reviewers (e.g., "coherence, feasibility")
- **Coverage attribution:** Attribute the merged finding to the persona with the highest confidence anchor. If anchors tie, attribute to the persona whose entry appeared first in document order. Decrement the losing persona's Findings count and the corresponding route bucket so totals stay exact.

### 3.3b Same-Persona Premise Redundancy Collapse

A single persona sometimes files multiple findings that share the same root premise expressed at different sections or wrapped in different framing (e.g., product-lens firing five variants of "motivation is weak" attached to Motivation, Unit 4b, Key Technical Decisions, and two other sections). Cross-persona dedup (3.3) does not catch this — it fingerprints on section+title, which differ even when the underlying concern is the same. Surfacing all N variants over-weights one persona's perspective relative to the other five and inflates the P2 Decisions tier with near-duplicate signal.

For each persona, cluster that persona's surviving findings by shared root premise. A cluster forms when 3 or more findings from the same persona share:

- The same `finding_type` (error or omission)
- Substantially overlapping `why_it_matters` phrasing (same key nouns/verbs signaling the same concern, e.g., "motivation", "justification", "premise unsupported", "scope creep")
- Fixes that would all be obviated by the same upstream decision (e.g., "add the triggering incident" would moot all five motivation-weakness findings)

For each cluster of size N ≥ 3:

- Keep the single finding with the strongest evidence (highest confidence anchor, or if tied, the one citing the most concrete document reference)
- Demote the remaining N-1 findings to FYI-subsection status (anchor `50`), regardless of their original anchor
- On the kept finding, note in the Reviewer column that the persona raised N-1 related variants (e.g., `product-lens (+4 related variants demoted to FYI)`)

This runs per-persona before 3.4 cross-persona boost. Cross-persona agreement across the *kept* finding still qualifies for the anchor-step promotion in 3.4; demoted variants do not participate in cross-persona promotion (they are observational only after collapse).

Do NOT collapse across personas at this step — different personas surfacing the same concern is exactly the independence signal the cross-persona boost rewards. Collapse applies within one persona's output only.

### 3.4 Cross-Persona Agreement Promotion

When 2+ independent personas flagged the same merged finding (from 3.3), promote the merged finding's anchor by one step: `50 → 75`, `75 → 100`. Anchor `100` does not promote further (already at the ceiling). Findings at anchors `0` or `25` do not reach this step (they were dropped in 3.2).

Independent corroboration is strong signal — multiple reviewers converging on the same issue is more reliable than any single reviewer's anchor. Promoting by one anchor step is semantically meaningful (a "verified but nitpick" finding that two personas independently surface is plausibly "will hit in practice"). This replaces the prior `+0.10` boost — the magic-number bump was calibrated to the continuous scale and no longer applies.

Note the promotion in the Reviewer column of the output (e.g., `coherence, feasibility (+1 anchor)`).

This replaces the earlier residual-concern promotion step. Findings at anchors `0` / `25` are not promoted back into the review surface; they appear only as drop counts in Coverage. If a dropped finding is genuinely important, the reviewer should raise their anchor to `50` or higher through stronger evidence rather than relying on a promotion rule.

### 3.5 Resolve Contradictions

When personas disagree on the same section:

- Create a combined finding presenting both perspectives
- Set `autofix_class: manual` (contradictions are by definition judgment calls)
- Set `finding_type: error` (contradictions are about conflicting things the document says, not things it omits)
- Frame as a tradeoff, not a verdict

Specific conflict patterns:

- Coherence says "keep for consistency" + scope-guardian says "cut for simplicity" → combined finding, let user decide
- Feasibility says "this is impossible" + product-lens says "this is essential" → P1 finding framed as a tradeoff
- Multiple personas flag the same issue (no disagreement) → handled in 3.3 merge, not here

### 3.5b Deterministic Recommended-Action Tie-Break

Every merged finding carries exactly one `recommended_action` field consumed by the walk-through (`references/walkthrough.md`) to mark the `(recommended)` option, by the best-judgment path (`references/bulk-preview.md`) to choose what to execute in bulk, and by the stem's yes/no framing. When a merged finding was flagged by multiple personas who implied different actions, synthesis picks the recommended action deterministically so identical review artifacts produce identical walk-through and best-judgment behavior across runs.

**Tie-break order (most conservative first):** `Skip > Defer > Apply`. The first action that at least one contributing persona implied wins, scanning in that order.

- If any contributing persona implied Skip → `recommended_action: Skip`
- Else if any contributing persona implied Defer → `recommended_action: Defer`
- Else → `recommended_action: Apply`

**Persona-to-action mapping.** A persona implies an action through its classification:

- `safe_auto` or `gated_auto` → implies Apply
- `manual` with a concrete `suggested_fix` and a recommended resolution → implies Apply (the persona has an opinion about what to do)
- `manual` flagged as a tradeoff or scope question with no recommended resolution → implies Defer (worth revisiting, not worth acting now)
- Any persona flagging the finding as low-confidence or suppression-eligible via residual concerns → implies Skip
- Persona in the contradiction set (3.5) implying "keep as-is / do not change" → implies Skip

If the contributing personas are all silent on action (e.g., a merged `manual` finding from personas that all flagged it as observation without recommendation), pick the default based on whether the merged finding carries an executable `suggested_fix`:

- `suggested_fix` present → `recommended_action: Apply` as the pragmatic default.
- `suggested_fix` absent → `recommended_action: Defer` (the walk-through and best-judgment path cannot execute Apply without a fix; routing an actionless finding to Defer surfaces it in Open Questions where the user can decide what to do with it).

This gate holds for every branch of the tie-break: if the winning action is `Apply` but the merged finding has no `suggested_fix` after 3.6 (Promote) and 3.7 (Route) have run, downgrade to `Defer`. The walk-through still lets the user pick any of the four options; this rule only governs the agent's default recommendation so the best-judgment path and bulk-preview never schedule a non-executable Apply.

**Conflict-context surface.** When the tie-break fires (contributing personas implied different actions), record a one-line conflict-context string on the merged finding. The walk-through renders this on the R15 conflict-context line (see `references/walkthrough.md`). Example: `Coherence recommends Apply; scope-guardian recommends Skip. Agent's recommendation: Skip.`

**Downstream invariant.** The walk-through and bulk-preview never recompute the recommendation — they read `recommended_action` and render `(recommended)` on the matching option. Best-judgment-the-rest and routing option B execute the `recommended_action` across the scoped finding set in bulk. This keeps best-judgment outcomes reproducible and auditable: the same review artifact always produces the same bulk plan.

### 3.5c Premise-Dependency Chain Linking

Document reviews often produce fanout: a single premise challenge ("is this work justified?") generates downstream findings that all evaporate if the premise is rejected ("alias unjustified", "abstraction overkill", "migration lacks rollback", "naming forecloses future"). Surfacing each as an independent decision forces the user to re-litigate the same root question N times. This step links dependent findings to their root so presentation can group them and the walk-through can cascade a single root decision across the chain.

Run this step after 3.5b (recommended_action normalized) and before 3.6 (auto-promotion), operating on the merged finding set.

**Step 1: Identify roots.** A finding is a candidate root when ALL of the following hold:

- Severity is `P0` or `P1` (premise-level issues carry high priority by nature)
- `autofix_class` is `manual` (the root itself requires judgment — a safe/gated root is acted on, not cascaded)
- `why_it_matters` or `title` challenges a foundational premise, not a detail. Signal phrases (shape, not vocabulary): "premise unsupported", "justification missing", "do-nothing baseline not evaluated", "is X justified", "unsupported by evidence", "is the proposed solution the right approach"
- The finding's `section` is framing-level (Problem Frame, Summary, Overview, Why, Motivation, Goals — `Summary` is the new ce-plan / ce-brainstorm template heading; `Overview` retained as legacy) OR the finding explicitly questions whether a named component should exist

If multiple candidates match the criteria, elevate ALL of them. The criteria above (P0/P1, manual, framing-level section, premise-challenge signal phrases) are restrictive enough that this list will be short for any well-formed document; do not impose a further numerical cap. Picking only one root when two valid roots exist leaves the second root's natural dependents stranded as independent manual findings — the exact UX problem chains are meant to solve.

**Peer vs nested test.** Two candidate roots are peers when accepting root A's proposed fix would not resolve root B's concern (and vice versa). They are nested when one root's fix would moot the other — in which case the subsumed candidate becomes a dependent of the surviving root, not a peer root. Apply the test symmetrically: check both directions before deciding.

**Surviving-root selection under asymmetric subsumption.** When nested, the surviving root is the one whose fix moots the other — **not** the one with higher confidence. If accepting Root A's fix moots Root B's concern, but accepting Root B's fix leaves Root A's concern standing, A is the surviving root and B becomes its dependent, regardless of which candidate scored higher confidence. The subsumption direction determines scope (broader premise wins); confidence determines strength, not scope. Confidence is used for tie-breaking *among peers*, not for deciding which of two nested candidates dominates.

**Sanity diagnostic.** If more than 3 candidates match, reconsider whether the criteria are being applied correctly — it is unusual for a single document to contain more than 3 genuinely distinct premise-level challenges. Do not silently drop candidates; either confirm each one independently meets the criteria (and surface them all), or tighten the application of the criteria. If the count is legitimately high, surfacing all of them is more useful than hiding any.

If none match, skip the rest of this step — no chains exist.

**Dependent assignment under multiple roots.** When multiple roots exist and a candidate dependent could plausibly link to more than one, assign it to the root whose rejection most directly dissolves the dependent's concern. If ambiguity remains, assign to the root with the higher confidence anchor; if anchors tie, assign to the root appearing first in document order. A dependent never links to more than one root — a single `depends_on` value.

**Step 2: Identify dependents.** For each candidate root, scan the remaining findings for dependents. The predicate must match the cascade trigger in `references/walkthrough.md` — dependents cascade when the user rejects (Skip/Defer) the root, so dependency is defined on the rejection branch, not the acceptance branch. A finding is a dependent of a root when:

- The root challenges a foundational premise about a named component — questioning whether it should exist, whether the proposed approach is correct, or whether the work is justified. Shapes to recognize (not a vocabulary list — map to whatever the document's domain actually uses): a compatibility layer whose necessity is challenged, a planned feature whose justification is in doubt, an abstraction whose warrant is questioned, a proposed change whose scope is disputed, a migration target whose choice is contested, an architectural commitment whose basis is unsupported
- The candidate's `suggested_fix` modifies, adds detail to, or constrains that same component
- The candidate's concern would dissolve if the root's premise is rejected — meaning: if the user rejects the root (Skip/Defer), the component the dependent targets is no longer a settled part of the plan, so the dependent's fix has nothing stable to act on and batch-rejects with the root

Test with the substitution check: "If the user rejects the root (Skip/Defer), does the dependent's finding still describe an actionable concern the user would want to engage with this round?" If no — the dependent's premise dissolves alongside the root's — it is a dependent. If yes (the finding identifies a problem that survives root rejection), it is not.

**Step 3: Independence safeguard.** Even when a finding's target component is addressed by the root, do NOT link if:

- The dependent identifies a problem that would exist regardless of the root's resolution. A migration's rollback plan, a module's error handling, a feature's test coverage — these are operational obligations that don't evaporate when the premise changes. They describe how a component must behave if it exists at all.
- The dependent's `why_it_matters` cites evidence (codebase fact, framework convention, production data) that stands on its own, not conditioned on the premise
- The dependent is `safe_auto` — it has one clear correct fix and should apply regardless of the root's resolution

When uncertain, default to NOT linking. A mis-linked chain hides a real issue; leaving a finding unlinked only costs one extra decision.

**Step 4: Annotate.** On each dependent, record `depends_on: <root_finding_id>` (use section + normalized title as the id). On each root, record `dependents: [<dependent_ids>]`. Cap `dependents` at 6 entries per root — if more than 6 candidates link to the same root, keep the top 6 by severity, then confidence anchor (descending), then document order as the deterministic final tiebreak; leave the rest unlinked (over-aggressive chaining risks obscuring independent concerns).

Do NOT reclassify, re-route, or change the confidence anchor of any finding in this step. Linking is purely annotative; the walk-through and presentation use the annotation, synthesis proper does not.

**Step 5: Report in Coverage.** Add a line to the coverage summary: `Chains: N root(s) with M total dependents`. When N = 0, omit the line.

**Count invariant (critical — do not violate).** `M` in the coverage line is the number of findings with `depends_on` set after Step 4 completes — i.e., the final linked count after steps 2 (candidacy), 3 (independence safeguard), and 4 (cap). It is NOT the number of candidates considered in Step 2. The same `dependents` array is the source of truth for both coverage counting AND rendering the `Dependents (...)` sub-block. If a finding appears in a root's `dependents` array, it MUST appear nested under that root in the presentation and MUST NOT appear at its own severity position. If a finding does NOT appear in any root's `dependents` array, it MUST appear at its own severity position and MUST NOT appear nested anywhere. Coverage count and rendering drift apart only if the orchestrator is using two different source-of-truth values — there is exactly one, the post-Step-4 `dependents` array on each root.

**Worked example A (rename-shape).** Review of a refactor plan surfaces 11 findings. One is P0 manual "Rename premise unsupported by user-facing evidence" in Problem Frame — a candidate root. Scanning the other 10:

- P1 manual "Alias mechanism unjustified scope" — root proposes scoping down to a pure alias-free rename; dependent's fix proposes dropping alias infrastructure. Linked.
- P2 manual "AliasedCommand abstraction overkill" — abstraction exists to support the alias; if alias dropped, abstraction dissolves. Linked.
- P2 manual "Rename forecloses dual-mode future" — concern only exists if rename proceeds. Linked.
- P2 manual "Identity drift: command vs artifact names" — naming asymmetry only exists if rename proceeds. Linked.
- P1 manual "Migration lacks rollback strategy" — migration needs rollback regardless of scope. NOT linked (independence safeguard).
- P0 gated_auto "Deployment-ordering between migration and code" — concrete fix user confirms regardless. NOT linked (safeguard: gated_auto with own resolution path).

Result: 1 root + 4 dependents. User sees the root first; rejecting it cascades the 4 dependents to auto-resolved. Manual engagement drops from 11 → 7 (6 unlinked + 1 visible root).

**Worked example B (auth-shape).** Review of a plan to introduce a new session-management middleware. One finding is P1 manual "Middleware rewrite premise unsupported — existing session handling has no reported reliability issues" in Problem Frame. Scanning the other findings:

- P2 manual "Middleware abstraction boundary unclear vs existing request context" — the boundary only matters if the middleware is built. Linked.
- P2 manual "Rollout strategy for new session store not specified" — the rollout only matters if the new store ships. Linked.
- P1 gated_auto "CSRF token regeneration missing on session rotation" — a real security gap in the plan's written design, independent of whether the middleware is the right approach. NOT linked (safeguard: gated_auto, concrete fix applies regardless).
- P2 manual "Existing session timeout behavior not captured in tests" — this is a pre-existing test coverage gap. It exists in the current code regardless of whether the rewrite happens. NOT linked (independence safeguard).

Result: 1 root + 2 dependents. The shape is the same as Example A — different vocabulary, different domain — which is the pattern to recognize.

### 3.6 Promote Auto-Eligible Findings

Scan `manual` findings for promotion to `safe_auto` or `gated_auto`. Promote when the finding meets one of the consolidated auto-promotion patterns:

- **Codebase-pattern-resolved.** `why_it_matters` cites a specific existing codebase pattern (concrete file/function/usage reference, not just "best practice" or "convention"), and `suggested_fix` follows that pattern. Promote to `gated_auto` — the user still confirms, but the codebase evidence resolves ambiguity.
- **Factually incorrect behavior.** The document describes behavior that is factually wrong, and the correct behavior is derivable from context or the codebase. Promote to `gated_auto`.
- **Missing standard security/reliability controls.** The omission is clearly a gap (not a legitimate design choice for the system described), and the fix follows established practice (HTTPS enforcement, checksum verification, input sanitization, fallback-with-deprecation-warning on renames). Promote to `gated_auto`.
- **Framework-native-API substitutions.** A hand-rolled implementation duplicates first-class framework behavior, and the framework API is cited. Promote to `gated_auto`.
- **Mechanically-implied completeness additions.** The missing content follows mechanically from the document's own explicit, concrete decisions (not high-level goals). Promote to `safe_auto` when there is genuinely one correct addition; `gated_auto` when the addition is substantive.

Do not promote if the finding involves scope or priority changes where the author may have weighed tradeoffs invisible to the reviewer.

**Strawman-downgrade safeguard.** If a `safe_auto` finding names dismissed alternatives in `why_it_matters` (per the subagent template's strawman rule), verify the alternatives are genuinely strawmen. If any alternative is a plausible design choice that the persona dismissed too aggressively, downgrade to `gated_auto` so the user sees the tradeoff before the fix applies.

### 3.7 Route by Autofix Class

**Severity and autofix_class are independent.** A P1 finding can be `safe_auto` if the correct fix is obvious. The test is not "how important?" but "is there one clear correct fix, or does this require judgment?"

**Anchor and autofix_class are also independent.** Anchor gates the finding into a surface (FYI vs actionable); `autofix_class` decides what the actionable surface does with it. Both are consulted in this step.

Findings reaching 3.7 have already been gated to anchors `50`, `75`, or `100` by 3.2 (anchors `0` and `25` were dropped).

| Anchor | Autofix Class | Route |
|--------|---------------|-------|
| `100`  | `safe_auto`   | Apply silently in Phase 4. Requires `suggested_fix`. Demote to `gated_auto` if missing. |
| `100`  | `gated_auto`  | Enter the per-finding walk-through with Apply marked (recommended). Requires `suggested_fix`. Demote to `manual` if missing. |
| `100`  | `manual`      | Enter the per-finding walk-through with user-judgment framing. `suggested_fix` is optional. |
| `75`   | `safe_auto`   | Demote to `gated_auto` before routing — silent apply is reserved for anchor `100` findings where evidence directly confirms the fix. Enter the walk-through with Apply marked (recommended). |
| `75`   | `gated_auto`  | Enter the per-finding walk-through with Apply marked (recommended). Requires `suggested_fix`. Demote to `manual` if missing. |
| `75`   | `manual`      | Enter the per-finding walk-through with user-judgment framing. `suggested_fix` is optional. |
| `50`   | any           | Surface in the FYI subsection regardless of `autofix_class`. Do not enter the walk-through or any bulk action. These are observations, not decisions. |

**Auto-eligible patterns for safe_auto:** summary/detail mismatch (body authoritative over overview), wrong counts, missing list entries derivable from elsewhere in the document, stale internal cross-references, terminology drift, prose-vs-diagram inconsistency where the diagram can be mechanically updated to match the prose (deletion is never the fix — diagrams are intentional communication choices that aid spatial comprehension, not redundancy with prose), missing steps mechanically implied by other content, unstated thresholds implied by surrounding context.

**Auto-eligible patterns for gated_auto:** codebase-pattern-resolved fixes, factually incorrect behavior, missing standard security/reliability controls, framework-native-API substitutions, substantive completeness additions mechanically implied by explicit decisions.

### 3.8 Sort

Sort findings for presentation: P0 → P1 → P2 → P3, then by finding type (errors before omissions), then by confidence anchor (descending: `100` first, then `75`, then `50`), then by document order (section position) as the deterministic final tiebreak.

### 3.9 Suppress Restatements in Residual Concerns and Deferred Questions

Persona outputs carry `residual_risks` and `deferred_questions` arrays alongside `findings`. After the actionable-tier set is finalized (post-3.7 routing), personas often re-surface the same substance in their residual/deferred arrays — the persona's own finding and the persona's own residual concern are about the same issue. Rendering both sections verbatim inflates the output with restatements that carry no new signal.

For every `residual_risk` and `deferred_question` across all persona outputs, check against the finalized actionable-finding set (findings at confidence anchor `75` or `100`, plus FYI-subsection findings at anchor `50`). Drop the residual/deferred item if either of these holds:

- **Section-and-substance overlap.** The residual/deferred item names the same section as an actionable finding AND its substance fuzzy-matches the finding's `title` or `why_it_matters` (shared key nouns/verbs indicating the same concern).
- **Question form of an actionable finding.** A deferred question whose subject is directly answered by or obviated by an actionable finding's recommendation. Example: actionable finding "Motivation cites no real incident" → deferred question "Is there a concrete triggering event?" — the finding already raised this; the question restates it interrogatively.

Do NOT drop residual/deferred items that introduce genuinely new signal (a concern or question the actionable findings do not touch). When in doubt, keep — this pass is for obvious restatements, not borderline calls.

Run this pass on the merged set across all personas. Record the count dropped as a Coverage footnote line when non-zero: `Restated: N (residual/deferred items suppressed as duplicates of actionable findings)`. Ordering: footnotes appear in the sequence `Dropped:`, `Chains:`, `Restated:` below the Coverage table, each on its own line. Omit any footnote whose count is zero.

## Phase 4: Apply and Present

**User-facing vocabulary rule (applies to ALL user-visible output in Phase 4, not just the rendered template).** Internal enum values — `safe_auto`, `gated_auto`, `manual`, `FYI` — stay inside the schema and synthesis prose. Every word the user sees in Phase 4 output, including free-text narration between sections, transition preambles, status lines, and confirmation messages, MUST use user-facing vocabulary: "fixes" (for `safe_auto`), "proposed fixes" (for `gated_auto`), "decisions" (for `manual` findings at anchor `75` or `100`), "FYI observations" (for any finding at anchor `50`). The only exception is the `Tier` column in rendered tables, which is explicitly documented as surfacing the internal enum for transparency. Do NOT emit narration like "safe_auto fixes applied" or "N safe_auto findings" — write "fixes applied" or "N fixes" instead.

### Apply safe_auto fixes

Apply only `safe_auto` findings **at confidence anchor `100`** to the document in a single pass. This matches the 3.7 routing table: anchor `100` + `safe_auto` silent-applies; anchor `75` + `safe_auto` was demoted to `gated_auto` in 3.7 and enters the walk-through instead; anchor `50` + any `autofix_class` routes to FYI and must never auto-apply.

- Edit the document inline using the platform's edit tool
- Track what was changed for the "Applied fixes" section in the rendered output (`safe_auto` is the internal enum; the rendered section header reads "Applied fixes")
- Do not ask for approval — these have one clear correct fix AND evidence directly confirms (anchor `100`)
- Do NOT silent-apply any `safe_auto` finding at anchor `75` or `50`. If a finding reaches this step with `autofix_class: safe_auto` and anchor below `100`, the 3.7 routing rule was not applied correctly; re-run 3.7 for that finding before continuing.

List every applied fix in the output summary so the user can see what changed. Use enough detail to convey the substance of each fix (section, what was changed, reviewer attribution). This is especially important for fixes that add content or touch document meaning — the user should not have to diff the document to understand what the review did.

### Route Remaining Findings

After safe_auto fixes apply, remaining findings split into buckets:

- `gated_auto` and `manual` findings at confidence anchor `75` or `100` → enter the routing question (see Unit 5 / `references/walkthrough.md`)
- FYI-subsection findings → surface in the presentation only, no routing
- Zero actionable findings remaining → skip the routing question; flow directly to Phase 5 terminal question

**Headless mode:** Do not use interactive question tools. Output all findings as a structured text envelope the caller can parse. Internal enum values (`safe_auto`, `gated_auto`, `manual`, `FYI`) stay in the schema and synthesis prose; the envelope below uses user-facing vocabulary — "fixes", "Proposed fixes", "Decisions", "FYI observations" — so headless output reads the same way interactive output does.

```
Document review complete (headless mode).

Applied N fixes:
- <section>: <what was changed> (<reviewer>)
- <section>: <what was changed> (<reviewer>)

Proposed fixes (concrete fix, requires user confirmation):

[P0] Section: <section> — <title> (<reviewer>, confidence <anchor>)
  Why: <why_it_matters>
  Suggested fix: <suggested_fix>

Decisions (requires user judgment):

[P1] Section: <section> — <title> (<reviewer>, confidence <anchor>)
  Why: <why_it_matters>
  Suggested fix: <suggested_fix or "none">

  Dependents (would resolve if this root is rejected):
    [P2] Section: <section> — <title> (<reviewer>, confidence <anchor>)
      Why: <why_it_matters>
    [P2] Section: <section> — <title> (<reviewer>, confidence <anchor>)
      Why: <why_it_matters>

FYI observations (anchor 50, no decision required):

[P3] Section: <section> — <title> (<reviewer>, confidence <anchor>)
  Why: <why_it_matters>

Residual concerns:
- <concern> (<source>)

Deferred questions:
- <question> (<source>)

Dropped: N (anchors 0/25 suppressed)
Chains: N root(s) with M dependents
Restated: N (residual/deferred items suppressed as duplicates of actionable findings)

Review complete
```

Omit any section with zero items. The section headers reflect user-facing vocabulary: the "Proposed fixes" bucket carries `gated_auto` findings at anchor `75` or `100` (the persona has a concrete fix; the user confirms), "Decisions" carries `manual` findings at anchor `75` or `100` (judgment calls), and "FYI observations" carries any finding at anchor `50` regardless of `autofix_class`. When a root has dependents, render the root at its normal position in the severity-sorted list and nest its dependents as an indented `Dependents (...)` sub-block immediately below. Do not re-list dependents at their own severity position — they appear only under their root. End with "Review complete" as the terminal signal so callers can detect completion.

**Compact rendering for FYI observations, residual concerns, and deferred questions (high-count mode).** When the combined count of these three buckets is 5 or more, collapse each to a one-line count followed by a tight bullet list without per-item `Why` expansion. Actionable buckets (Proposed fixes / Decisions) remain fully rendered regardless. This mirrors the interactive-mode rule in `references/review-output-template.md` so both modes produce the same shape.

**Interactive mode:**

Present findings using the review output template (read `references/review-output-template.md`). Within each severity level, separate findings by type:

- Errors (design tensions, contradictions, incorrect statements) first — these need resolution
- Omissions (missing steps, absent details, forgotten entries) second — these need additions

Brief summary at the top: "Applied N fixes. K items need attention (X errors, Y omissions). Z FYI observations."

Include the Coverage table, applied fixes, FYI observations (as a distinct subsection), residual concerns, and deferred questions.

**All tables MUST be pipe-delimited markdown (`| col | col |`). Do NOT use ASCII box-drawing characters (`┌ ┬ ┐ ├ ┼ ┤ └ ┴ ┘ │ ─`) under any circumstances, including for the Coverage table.** This rule restates the template's formatting requirement at the point of rendering so it cannot drift. Pipe-delimited tables render correctly across all target harnesses; box-drawing characters break rendering in some and violate the repo convention documented in root `AGENTS.md`.

### R29 Rejected-Finding Suppression (Round 2+)

When the orchestrator is running round 2+ on the same document in the same session, the decision primer (see `SKILL.md` — Decision primer) carries forward every prior-round Skipped, Deferred, and Acknowledged finding. Synthesis suppresses re-raised rejected findings rather than re-surfacing them to the user. Acknowledged is treated as a rejected-class decision here: the user saw the finding, chose not to act on it (no Apply, no Defer append), and wants it on record — equivalent to Skip for suppression purposes.

For each current-round finding, compare against the primer's rejected list:

- **Matching predicate:** same as R30 — `normalize(section) + normalize(title)` fingerprint augmented with evidence-substring overlap check (>50%). If a current-round finding matches a prior-round rejected finding on fingerprint AND evidence overlap, drop the current-round finding.
- **Materially-different exception:** if the current document state has changed around the finding's section since the prior round (e.g., the section was edited and the evidence quote no longer appears in the current text), treat the finding as new — the underlying context shifted and the concern may be genuinely different now. The persona's evidence itself reveals this: a quote that doesn't appear in the current document is a signal the prior-round rejection no longer applies.
- **On suppression:** record the drop in Coverage with a "previously rejected, re-raised this round" note so the user can see what was suppressed. The user can explicitly escalate by invoking the review again on a different context if they believe the suppression was wrong.

This rule runs at synthesis time, not at the persona level. Personas have a soft instruction via the subagent template's `{decision_primer}` variable to avoid re-raising rejected findings, but the orchestrator is the authoritative gate — if a persona re-raises despite the primer, synthesis drops the finding.

### R30 Fix-Landed Matching Predicate

When the orchestrator is running round 2+ on the same document (see Unit 7 multi-round memory), synthesis verifies that prior-round Applied findings actually landed. For each current-round finding whose `normalize(section) + normalize(title)` fingerprint matches a prior-round Applied finding (same fingerprint as 3.3 dedup), branch by evidence overlap:

- **Strong match — evidence overlap >50% with the prior-round evidence: fix-landed regression.** The current-round finding is quoting the same problematic text the prior-round fix was supposed to remove. Flag as "fix did not land" in the report rather than surfacing as a new finding. Include the prior-round finding's title and the current-round persona's evidence so the user can see why the verification flagged it.

- **Weak match — evidence overlap ≤50%: not a fix-landed regression.** Low evidence overlap means the prior problematic text is no longer being quoted, so do not flag "fix did not land." Do not suppress solely on fingerprint match. If the current-round item is explicitly a non-actionable verification observation (for example, its title or `why_it_matters` says the prior finding landed correctly and asks for no change), suppress it and record `Verified: round-{N} '{title}' landed correctly` in Coverage. Otherwise, treat the finding as new and let it flow through dedup and routing normally.

  **Materially-different exception.** If the current-round finding's `why_it_matters` describes a substantively different concern than the prior-round finding — even though the section/title fingerprint matches — treat it as a new finding rather than a fix-verified suppression. The section may have been edited for an unrelated reason and the new edit introduced a different issue. The persona's substance, not just the fingerprint, is the signal.

- **Section renames count as different locations.** If the section name has changed between rounds (edit introduced a heading rename), treat the new section as a different location and the current-round finding as new — neither branch fires.

- **No fingerprint match:** not a verification candidate; the finding flows through normally to 3.3 dedup and onward routing.

This rule prevents two failure modes: (1) regressions where a fix didn't actually land, and (2) persona over-emission where a round-{N+1} reviewer correctly observes a prior-round resolution and emits a non-actionable "already addressed" finding. The persona-side guidance in `subagent-template.md` ("Do not emit findings to note prior-round resolutions") is the primary defense; this rule is the synthesis backstop.

### Protected Artifacts

During synthesis, discard any finding that recommends deleting or removing files in:

- `docs/brainstorms/`
- `docs/plans/`
- `docs/solutions/`

These are pipeline artifacts and must not be flagged for removal.

## Phase 5: Next Action — Terminal Question

**Headless mode:** Return "Review complete" immediately. Do not ask questions. The caller receives the text envelope from Phase 4 and handles any remaining findings.

**Interactive mode:** fire the terminal question using the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)). In Claude Code the tool should already be loaded from the Interactive-mode pre-load step in `SKILL.md` — if it isn't, call `ToolSearch` with `select:AskUserQuestion` now. Fall back to numbered options in chat only when no blocking tool exists in the harness or the call errors (e.g., Codex edit modes) — not because a schema load is required. Never silently skip the question. This question is distinct from the mid-flow routing question (`references/walkthrough.md`) — the routing question chooses *how* to engage with findings, this one chooses *what to do next* once engagement is complete. Do not merge them.

**Stem:** `Apply decisions and what next?`

**Options (three by default; two in the zero-actionable case):**

When `fixes_applied_count > 0` (at least one safe_auto or Apply decision has landed this session):

```
A. Apply decisions and proceed to <next stage>
B. Apply decisions and re-review
C. Exit without further action
```

When `fixes_applied_count == 0` (zero-actionable case, or the user took routing option D / every walk-through decision was Skip):

```
A. Proceed to <next stage>
B. Exit without further action
```

The `<next stage>` substitution uses the document type from Phase 1:

- Requirements document → `ce-plan`
- Plan document → `ce-work`

**Label adaptation:** when no decisions are queued to apply, the primary option drops the `Apply decisions and` prefix — the label should match what the system is doing. `Apply decisions and proceed` when fixes are queued; `Proceed` when nothing is queued.

**Caller-context handling (implicit):** the terminal question's "Proceed to <next stage>" option is interpreted contextually by the agent from the visible conversation state. When ce-doc-review is invoked from inside another skill's flow (e.g., ce-brainstorm Phase 4 re-review, ce-plan phase 5.3.8), the agent does not fire a nested `/ce-plan` or `/ce-work` dispatch — it returns control to the caller's flow which continues its own logic. When invoked standalone, "Proceed" dispatches the appropriate next skill. No explicit caller-hint argument is required; if this implicit handling proves unreliable in practice, an explicit `nested:true` flag can be added as a follow-up.

### Iteration limit

After 2 refinement passes, recommend completion — diminishing returns are likely. But if the user wants to continue, allow it; the primer carries all prior-round decisions so later rounds suppress repeat findings cleanly.

Return "Review complete" as the terminal signal for callers, regardless of which option the user picked.

## What NOT to Do

- Do not rewrite the entire document
- Do not add new sections or requirements the user didn't discuss
- Do not over-engineer or add complexity
- Do not create separate review files or add metadata sections
- Do not modify caller skills (ce-brainstorm, ce-plan, or external plugin skills that invoke ce-doc-review)

## Iteration Guidance

On subsequent passes, re-dispatch personas with the multi-round decision primer (see Unit 7) and re-synthesize. Fixed findings self-suppress because their evidence is gone from the current doc; rejected findings are handled by the R29 pattern-match suppression rule; applied-fix verification uses the R30 matching predicate above. If findings are repetitive across passes after these mechanisms run, recommend completion.
