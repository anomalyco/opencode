---
name: score-candidate
description: Score a resume against HIRING.md with structured scores and file-path evidence. Write the score onto the candidate card. Use when evaluating a candidate for a req.
---

# score-candidate

Score one candidate against this cwd req. Cite evidence; never invent employment history.

Score lives on the card: `candidates/<id>.md` frontmatter `score` plus body.

## Discover inputs

1. User-attached paths
2. If Ashby MCP tools are available, prefer `ashby_get_candidate` / `ashby_list_candidates` (and job reads) over inventing ATS state; still load local resume text when scoring depth needs it
3. Cwd: `HIRING.md`, `candidates/<id>.md`
4. Product fixture samples only as last resort

Load HIRING.md + the candidate card (or attached resume) at minimum. Use scorecard dimensions from HIRING.md when present; otherwise derive dimensions from must-haves. Never call Ashby write tools; stage moves use `moks commit` / `moks push` only.

## Output format

```markdown
# Score: <candidate name> → <role>

## Summary
- Recommendation: strong yes | yes | mixed | no | strong no
- One-line rationale:

## Dimension scores
| Dimension | Score (1-5) | Evidence | Source |
|-----------|-------------|----------|--------|
| ... | n | quote or fact | candidates/<id>.md / HIRING.md |

## Strengths
- ...

## Risks / gaps
- ...

## Interview focus
- Questions or probes tied to weak/unclear dimensions

## Sources
- absolute or repo-relative paths used
```

## Write the score onto the card (required)

After the table, write the full score markdown into `candidates/<id>.md`. Set frontmatter `score:` (1–5 overall or the agreed scale). Keep existing frontmatter (`id`, `stage`, `source`, `ats_id`, name). Create the card if it does not exist.

Chat may show the same table; the card is the source of truth. You are not done until the file is written (unless the workspace is read-only or the user forbade writes).

## Rules

- Every score row needs evidence + source path
- If a dimension is unknown from materials, score as N/A and list under gaps
- Do not run disposition verbs here; use commit-disposition when recommending a stage move
