---
name: req-context
description: Load and synthesize a hiring req brief from local JD and notes. List missing context. Use when starting a req or when the user asks what the role needs.
---

# req-context

Build a structured req brief from local materials. Do not invent company secrets or headcount.

## Discover inputs

Resolve in order (stop when found):

1. User-attached paths (`-f` / @ files)
2. If Ashby MCP tools are available (`ashby_list_jobs`, `ashby_get_job`, …), prefer reading open jobs/req metadata via those tools
3. Cwd: `jd.md`, optional `notes.md` / `scorecard.md`
4. `.moks/req/jd.md`, `.moks/req/notes.md`, `.moks/req/scorecard.md`
5. Samples only if nothing else: ship path under product fixtures/hiring

Read every file or MCP payload you will cite. Never call Ashby write tools (`ashby_change_stage`, `ashby_create_note`); dispositions go through `moks propose` / `moks apply`.

## Output format

```markdown
# Req brief: <role title>

## Role
- Level / family:
- Team / manager (if known):
- Location / remote:
- Must-haves:
- Nice-to-haves:
- Deal-breakers:

## Success signals
- 30/60/90 or interview bar (from scorecard if present):

## Process notes
- Stages / owners (only if in materials):

## Missing context
- [ ] ...

## Sources
- path/to/jd.md
```

## Rules

- Quote or paraphrase only what files support; mark gaps under Missing context
- If JD is absent, ask for path or paste — do not fabricate a full JD
- Keep the brief short enough to reuse in score-candidate and draft-outreach
