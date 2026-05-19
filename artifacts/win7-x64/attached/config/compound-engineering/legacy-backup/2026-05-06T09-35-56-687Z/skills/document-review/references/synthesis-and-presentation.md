# Phases 3-5: Synthesis, Presentation, and Next Action

## Phase 3: Synthesize Findings

Process findings from all agents through this pipeline. **Order matters** -- each step depends on the previous.

### 3.1 Validate

Check each agent's returned JSON against the findings schema:
- Drop findings missing any required field defined in the schema
- Drop findings with invalid enum values
- Note the agent name for any malformed output in the Coverage section

### 3.2 Confidence Gate

Suppress findings below 0.50 confidence. Store them as residual concerns for potential promotion in step 3.4.

### 3.3 Deduplicate

Fingerprint each finding using `normalize(section) + normalize(title)`. Normalization: lowercase, strip punctuation, collapse whitespace.

When fingerprints match across personas:
- If the findings recommend **opposing actions** (e.g., one says cut, the other says keep), do not merge -- preserve both for contradiction resolution in 3.5
- Otherwise merge: keep the highest severity, keep the highest confidence, union all evidence arrays, note all agreeing reviewers (e.g., "coherence, feasibility")
- **Coverage attribution:** Attribute the merged finding to the persona with the highest confidence. Decrement the losing persona's Findings count *and* the corresponding route bucket (Auto or Present) so `Findings = Auto + Present` stays exact.

### 3.4 Promote Residual Concerns

Scan the residual concerns (findings suppressed in 3.2) for:
- **Cross-persona corroboration**: A residual concern from Persona A overlaps with an above-threshold finding from Persona B. Promote at P2 with confidence 0.55-0.65. Inherit `finding_type` from the corroborating above-threshold finding.
- **Concrete blocking risks**: A residual concern describes a specific, concrete risk that would block implementation. Promote at P2 with confidence 0.55. Set `finding_type: omission` (blocking risks surfaced as residual concerns are inherently about something the document failed to address).

### 3.5 Resolve Contradictions

When personas disagree on the same section:
- Create a **combined finding** presenting both perspectives
- Set `autofix_class: present`
- Set `finding_type: error` (contradictions are by definition about conflicting things the document says, not things it omits)
- Frame as a tradeoff, not a verdict

Specific conflict patterns:
- Coherence says "keep for consistency" + scope-guardian says "cut for simplicity" -> combined finding, let user decide
- Feasibility says "this is impossible" + product-lens says "this is essential" -> P1 finding framed as a tradeoff
- Multiple personas flag the same issue -> merge into single finding, note consensus, increase confidence

### 3.6 Promote Pattern-Resolved Findings

Scan `present` findings for codebase-pattern-resolved auto-eligibility. Promote `present` -> `auto` when **all three** conditions are met:

1. The finding's `why_it_matters` cites a specific existing codebase pattern -- not just "best practice" or "convention," but a concrete pattern with a file, function, or usage reference
2. The finding includes a concrete `suggested_fix` that follows that cited pattern
3. There is no genuine tradeoff -- the codebase context resolves any ambiguity about which approach to use

The principle: when a reviewer mentions multiple theoretical approaches but the codebase already has an established pattern that makes one approach clearly correct, the codebase context settles the question. Alternatives mentioned in passing do not create a real tradeoff if the evidence shows the codebase has already chosen.

Additional auto-promotion patterns (promote `present` -> `auto` when):
- The finding identifies factually incorrect behavior in the document and the suggested fix describes the correct behavior (not a design choice between alternatives)
- The finding identifies a missing industry-standard security control where the document's own context makes the omission clearly wrong (not a legitimate design choice for the system described), and the suggested fix follows established practice
- The finding identifies an incomplete technical description and the complete version is directly derivable from the codebase (the reviewer cited specific code showing what the description should say)

Do not promote if the finding involves scope or priority changes where the document author may have weighed tradeoffs invisible to the reviewer.

### 3.7 Route by Autofix Class

**Severity and autofix_class are independent.** A P1 finding can be `auto` if the correct fix is obvious. The test is not "how important?" but "is there one clear correct fix, or does this require judgment?"

| Autofix Class | Route |
|---------------|-------|
| `auto` | Apply automatically -- one clear correct fix. Includes internal reconciliation (one part authoritative over another), additions mechanically implied by the document's own content, and codebase-pattern-resolved fixes where codebase evidence makes one approach clearly correct. |
| `present` | Present individually for user judgment |

Demote any `auto` finding that lacks a `suggested_fix` to `present`.

**Auto-eligible patterns:** summary/detail mismatch (body is authoritative over overview), wrong counts, missing list entries derivable from elsewhere in the document, stale internal cross-references, terminology drift, prose/diagram contradictions where prose is more detailed, missing steps mechanically implied by other content, unstated thresholds implied by surrounding context, completeness gaps where the correct addition is obvious, codebase-pattern-resolved fixes where the reviewer cites a specific existing pattern and the suggested_fix follows it, factually incorrect behavior where the correct behavior is obvious from context or the codebase, missing standard security controls with known implementations, incomplete technical descriptions where the complete version is derivable from the codebase. If the fix requires judgment about *what* to do (not just *what to write*) and the codebase context does not resolve the ambiguity, it belongs in `present`.

### 3.8 Sort

Sort findings for presentation: P0 -> P1 -> P2 -> P3, then by finding type (errors before omissions), then by confidence (descending), then by document order (section position).

## Phase 4: Apply and Present

### Apply Auto-fixes

Apply all `auto` findings to the document in a **single pass**:
- Edit the document inline using the platform's edit tool
- Track what was changed for the "Auto-fixes Applied" section
- Do not ask for approval -- these have one clear correct fix

List every auto-fix in the output summary so the user can see what changed. Use enough detail to convey the substance of each fix (section, what was changed, reviewer attribution). This is especially important for fixes that add content or touch document meaning -- the user should not have to diff the document to understand what the review did.

### Present Remaining Findings

**Headless mode:** Do not use interactive question tools. Output all non-auto findings as a structured text summary the caller can parse and act on:

```
Document review complete (headless mode).

Applied N auto-fixes:
- <section>: <what was changed> (<reviewer>)
- <section>: <what was changed> (<reviewer>)

Findings (requires judgment):

[P0] Section: <section> — <title> (<reviewer>, confidence <N>)
  Why: <why_it_matters>
  Suggested fix: <suggested_fix or "none">

[P1] Section: <section> — <title> (<reviewer>, confidence <N>)
  Why: <why_it_matters>
  Suggested fix: <suggested_fix or "none">

Residual concerns:
- <concern> (<source>)

Deferred questions:
- <question> (<source>)
```

Omit any section with zero items. Then proceed directly to Phase 5 (which returns immediately in headless mode).

**Interactive mode:**

Present `present` findings using the review output template (read `references/review-output-template.md`). Within each severity level, separate findings by type:
- **Errors** (design tensions, contradictions, incorrect statements) first -- these need resolution
- **Omissions** (missing steps, absent details, forgotten entries) second -- these need additions

Brief summary at the top: "Applied N auto-fixes. K findings to consider (X errors, Y omissions)."

Include the Coverage table, auto-fixes applied, residual concerns, and deferred questions.

### Protected Artifacts

During synthesis, discard any finding that recommends deleting or removing files in:
- `docs/brainstorms/`
- `docs/plans/`
- `docs/solutions/`

These are pipeline artifacts and must not be flagged for removal.

## Phase 5: Next Action

**Headless mode:** Return "Review complete" immediately. Do not ask questions. The caller receives the text summary from Phase 4 and handles any remaining findings.

**Interactive mode:**

**Ask using the platform's interactive question tool** -- do not print the question as plain text output:
- Claude Code: `AskUserQuestion`
- Codex: `request_user_input`
- Gemini: `ask_user`
- Fallback (no question tool available): present numbered options and stop; wait for the user's next message

Offer these two options. Use the document type from Phase 1 to set the "Review complete" description:

1. **Refine again** -- Address the findings above, then re-review
2. **Review complete** -- description based on document type:
   - requirements document: "Create technical plan with ce:plan"
   - plan document: "Implement with ce:work"

After 2 refinement passes, recommend completion -- diminishing returns are likely. But if the user wants to continue, allow it.

Return "Review complete" as the terminal signal for callers.

## What NOT to Do

- Do not rewrite the entire document
- Do not add new sections or requirements the user didn't discuss
- Do not over-engineer or add complexity
- Do not create separate review files or add metadata sections
- Do not modify caller skills (ce-brainstorm, ce-plan, or external plugin skills that invoke document-review)

## Iteration Guidance

On subsequent passes, re-dispatch personas and re-synthesize. The auto-fix mechanism and confidence gating prevent the same findings from recurring once fixed. If findings are repetitive across passes, recommend completion.
