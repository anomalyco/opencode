---
name: score-candidate
description: Score a resume against JD and scorecard with structured scores and file-path evidence. Use when evaluating a candidate for a req.
---

# score-candidate

Score one candidate against the active req. Cite evidence; never invent employment history.

## Discover inputs

1. User-attached paths
2. If Ashby MCP tools are available, prefer `ashby_get_candidate` / `ashby_list_candidates` (and job reads) over inventing ATS state; still load local resume text when scoring depth needs it
3. Cwd: `jd.md`, `resume.md`, `scorecard.md`
4. `.moks/req/{jd,resume,scorecard}.md`
5. Product fixture samples only as last resort

Load JD + resume at minimum. Use scorecard dimensions when present; otherwise derive dimensions from JD must-haves. Never call Ashby write tools; stage moves use `moks commit` / `moks push` only.

## Output format

```markdown
# Score: <candidate name> → <role>

## Summary
- Recommendation: strong yes | yes | mixed | no | strong no
- One-line rationale:

## Dimension scores
| Dimension | Score (1-5) | Evidence | Source |
|-----------|-------------|----------|--------|
| ... | n | quote or fact | resume.md / jd.md |

## Strengths
- ...

## Risks / gaps
- ...

## Interview focus
- Questions or probes tied to weak/unclear dimensions

## Sources
- absolute or repo-relative paths used
```

## Write the score file (required)

After the table, write the full score markdown to `.moks/req/scores/<candidate-slug>.md` (slug: lowercase, hyphens). Create `.moks/req/scores/` if needed.

Chat may show the same table; the file is the source of truth. You are not done until the file is written (unless the workspace is read-only or the user forbade writes).

## Rules

- Every score row needs evidence + source path
- If a dimension is unknown from materials, score as N/A and list under gaps
- Do not run disposition verbs here; use commit-disposition when recommending a stage move
