# Open Questions Deferral

This reference defines the Defer action's in-doc append mechanic. When the user chooses Defer on a finding (from the walk-through or from the bulk-preview Append-to-Open-Questions path), an entry for that finding appends to a `## Deferred / Open Questions` section at the end of the document under review.

Interactive mode only. Invoked by `references/walkthrough.md` (per-finding Defer option) and `references/bulk-preview.md` (routing option C Proceed).

---

## Append flow

### Step 1: Locate or create the Open Questions section

Scan the document for an existing `## Deferred / Open Questions` heading (case-sensitive match on the full heading text). Behavior by location:

- **Heading present at the end of the document (last `##`-level section):** append new content inside this section at the end.
- **Heading present mid-document (not the last `##`-level section):** still append inside the existing heading at that location. Do not create a duplicate at the end — the user positioned the section deliberately.
- **Heading absent:** create `## Deferred / Open Questions` at the end of the document. If the document has a trailing horizontal-rule separator (`---`) or a trailing footer (table, links section), insert the new section above it. If the document has only frontmatter and no body, create the section after the frontmatter block (not at byte 0).

### Step 2: Locate or create the timestamped subsection

Within the Open Questions section, scan for a subsection heading matching the current review date: `### From YYYY-MM-DD review`. Behavior:

- **Subsection present:** append new entries to it. Multiple Defer actions within a single review session accumulate under the same subsection.
- **Subsection absent:** create `### From YYYY-MM-DD review` as the last subsection within the Open Questions section. Insert one blank line before the heading for readability.

Date format: ISO 8601 calendar date (`YYYY-MM-DD`). If multiple reviews occur on the same document on the same day within the same session, they still share the same subsection. Multi-day same-document reviews get distinct subsections, which is the intended behavior.

### Step 3: Format and append the entry

Per deferred finding, append a bullet-point entry with the following fields. The visible content is a reader-friendly summary; an HTML comment on the entry persists the dedup-key fields so Step 4's compound-key check can run reliably across retries and same-day reruns without requiring the entry format itself to carry machine-oriented metadata:

```
- **{title}** — {section} ({severity}, {reviewer}, confidence {confidence})

  {why_it_matters}

  <!-- dedup-key: section="{normalized_section}" title="{normalized_title}" evidence="{evidence_fingerprint}" -->
```

Fields come from the finding's schema:

- `{title}` — the finding's title field
- `{section}` — the finding's section field, unmodified (human-readable)
- `{severity}` — P0 / P1 / P2 / P3
- `{reviewer}` — the persona that produced the finding (after dedup, the persona with the highest confidence anchor; surface all co-flagging personas if multiple)
- `{confidence}` — the integer anchor (`50`, `75`, or `100`), emitted without a decimal point or percent sign
- `{why_it_matters}` — the full why_it_matters text, preserving the framing guidance from the subagent template

HTML-comment fields (machine-readable, used by Step 4 dedup):

- `{normalized_section}` — `normalize(section)` (lowercase, punctuation-stripped, whitespace-collapsed)
- `{normalized_title}` — `normalize(title)` (same normalization)
- `{evidence_fingerprint}` — first ~120 chars of the finding's first evidence quote, word-boundary-preserving, then sanitized for single-line HTML-comment embedding; empty string when the finding had no evidence. Sanitization (apply in order, before the 120-char slice so the resulting fingerprint stays under the budget):
  1. Collapse any run of whitespace — including newlines, carriage returns, and tabs — to a single space.
  2. Strip any occurrence of `-->` (HTML-comment terminator) and any stray `<!--` sequence; replace each with a single space. This prevents the evidence from closing the dedup-key comment prematurely or injecting a nested comment.
  3. Replace the double-quote character with `\"` (quote escaping, as before).
  4. Trim leading/trailing whitespace.

  The sanitized fingerprint MUST be a single line with no embedded `-->` so the dedup-key comment stays parseable by Step 4's compound-key reconstruction. When computing the fingerprint for a new finding, apply this sanitization; when reading back from an existing entry, treat the parsed `evidence="..."` value as already-sanitized and compare verbatim.

Do not include `suggested_fix` or the full `evidence` array in the appended entry. Those live in the review run artifact (when applicable) and do not belong in the document's Open Questions section — the entry is a concern summary for the reader returning later, not a full decision packet. The HTML-comment dedup-key line is the minimum machine-oriented metadata required for reliable idempotence and deliberately sits on a single line with simple `key="value"` shape so a retry can parse it without a markdown parser.

### Step 4: Idempotence on compound-key collisions

If an entry with the same compound key already exists under the same `### From YYYY-MM-DD review` subsection, do not append a duplicate. This can happen when:

- The same review session re-routes the same finding to Defer a second time (rare but possible via best-judgment-the-rest after a walk-through Defer)
- The orchestrator retries after a partial failure

**Compound key for dedup:** `normalize(section) + normalize(title) + evidence_fingerprint`, reconstructed from each existing entry's `<!-- dedup-key: ... -->` HTML comment (see Step 3 entry format). For a new finding about to append, compute the same fields from the finding's schema data; for existing entries, parse them out of the HTML comment. Match on all three fields.

- `normalize(section)` and `normalize(title)` use the same normalization as synthesis step 3.3 dedup (lowercase, strip punctuation, collapse whitespace)
- `evidence_fingerprint` is the first ~120 characters of the finding's first evidence quote, sanitized per Step 3 (whitespace collapsed to single spaces, `-->` and stray `<!--` stripped, quotes escaped). The same slice is used in the decision primer — see `SKILL.md` under "Decision primer". When no evidence is available on the new finding, fall back to section+title alone. When an existing entry's HTML comment has `evidence=""`, treat the entry as evidence-less and also fall back to section+title for that comparison. If an existing entry's dedup-key comment is malformed (e.g., a newline or `-->` sequence split the comment across lines in a pre-sanitization entry), treat that entry under the legacy-fallback rule below rather than attempting a partial reconstruction.

Title-only dedup is not sufficient: two different findings in the same document (even in the same review date) can legitimately share a short title if their sections and evidence differ. Using only `{title}` would silently drop one of them — losing user-visible backlog context. The compound key mirrors the R29/R30 matching predicate (`section + title + evidence-substring overlap`) so cross-round and intra-round dedup behave consistently.

**Legacy entries without dedup-key comments:** entries written before this format (if any survive in the wild) lack the HTML comment. When Step 4 encounters such an entry, fall back to title-only comparison for that entry — imperfect, but strictly better than duplicate-appending. This is a backwards-compat behavior for legacy data, not a sanctioned format.

On collision, record the no-op in the completion report's Coverage section so the user sees the duplicate was suppressed. Cross-subsection collisions (same compound key, different dates) are not deduplicated — each review is allowed to re-raise the same concern.

---

## Concurrent edit safety

Document edits happen via the platform's edit tool (Edit in Claude Code, or equivalent). Before every append, re-read the document from disk to reduce the window for user-in-editor concurrent-write collisions. If the document's mtime or content has changed unexpectedly between a prior read and the append attempt, abort the append and surface the situation via the failure path below. The user may be editing in their editor during the review session and simultaneous writes would corrupt the document.

The orchestrator only holds the most recent read in memory, not a persistent lock — interactive review doesn't need lock coordination; it needs observation-before-write.

---

## Failure path

When the append cannot complete — document is read-only on disk, path is invalid, the platform's edit tool returns an error, concurrent-edit collision detected, or any other write failure — surface the failure inline to the user via the platform's blocking question tool with the following sub-question:

**Stem:** `Couldn't append the finding to Open Questions. What should the agent do?`

**Options (exactly three; fixed order):**

```
A. Retry the append
B. Record the deferral in the completion report only (don't mutate the document)
C. Convert this finding to Skip
```

**Dispatch:**

- **A Retry** — try the append again. On repeated failure, loop back to the same sub-question.
- **B Record only** — skip the document mutation; record the Deferred action in the completion report with a note that the append failed. The finding does not end up in the document but the user sees in the report that they deferred it.
- **C Convert to Skip** — record the finding as Skip with an explanatory reason ("append to Open Questions failed: <error>"). The finding is treated as no-action for the remainder of the session.

Silent failure is not acceptable. If the user does not respond to the sub-question (session ends, terminal disconnects), default to option B so the in-memory decision state stays consistent even if the document wasn't written.

---

## Upstream availability signal

The walk-through and bulk-preview check append-availability before offering Defer as an option. When the document is known-unwritable (e.g., initial read shows it's on a read-only filesystem), the orchestrator caches an `append_available: false` signal at Phase 4 start and Defer is suppressed in the walk-through menu and in the routing question's option C. See `references/walkthrough.md` under "Adaptations" for the menu behavior and `references/bulk-preview.md` under "Edge cases" for the preview behavior.

When append-availability is true at Phase 4 start but an individual append fails mid-flow, the failure path above handles the specific finding — this does not flip the session-level cached signal (other findings may still append successfully if the failure was transient).

---

## Example appended content

Starting document state:

```markdown
## Risks

...existing content...

## Deferred / Open Questions

### From 2026-04-10 review

- **Alias compatibility-theater concern** — Risks (P1, scope-guardian, confidence 75)

  The alias exists without documented external consumers...

  <!-- dedup-key: section="risks" title="alias compatibilitytheater concern" evidence="the alias exists without documented external consumers" -->

```

After appending two findings in a 2026-04-18 session:

```markdown
## Risks

...existing content...

## Deferred / Open Questions

### From 2026-04-10 review

- **Alias compatibility-theater concern** — Risks (P1, scope-guardian, confidence 75)

  The alias exists without documented external consumers...

  <!-- dedup-key: section="risks" title="alias compatibilitytheater concern" evidence="the alias exists without documented external consumers" -->

### From 2026-04-18 review

- **Unit 2/3 merge judgment call** — Scope Boundaries (P2, scope-guardian, confidence 75)

  The two units update consumer sites that deploy together. Splitting
  adds dependency tracking without enabling independent delivery.

  <!-- dedup-key: section="scope boundaries" title="unit 23 merge judgment call" evidence="the two units update consumer sites that deploy together" -->

- **Strawman alternatives on migration strategy** — Unit 3 Files (P2, coherence, confidence 75)

  The fix options list (a) through (c) as alternatives, but (b) and (c)
  are "accept the regression" framings that don't solve the problem the
  finding describes.

  <!-- dedup-key: section="unit 3 files" title="strawman alternatives on migration strategy" evidence="the fix options list a through c as alternatives but b and c" -->
```
