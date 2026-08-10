---
name: score-candidate
description: Score a resume against JD and scorecard with structured scores and file-path evidence. Use when evaluating a candidate for a req.
---

# score-candidate

Score one candidate against the active req. Cite evidence; never invent employment history.

## Discover inputs

1. User-attached paths
2. Cwd: `jd.md`, `resume.md`, `scorecard.md`
3. `.moks/req/{jd,resume,scorecard}.md`
4. Product fixture samples only as last resort

Load JD + resume at minimum. Use scorecard dimensions when present; otherwise derive dimensions from JD must-haves.

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

## Rules

- Every score row needs evidence + source path
- If a dimension is unknown from materials, score as N/A and list under gaps
- Do not run disposition verbs here; use propose-disposition when recommending a stage move
