---
name: req-context
description: Load and synthesize a hiring req brief from HIRING.md. List missing context. Use when starting a req or when the user asks what the role needs.
---

# req-context

Build a structured req brief from local materials. Do not invent company secrets or headcount.

This cwd is the req. HIRING.md is the constitution.

## Discover inputs

Resolve in order (stop when found):

1. User-attached paths (`-f` / @ files)
2. If Ashby MCP tools are available (`ashby_list_jobs`, `ashby_get_job`, …), prefer reading open jobs/req metadata via those tools
3. Cwd: `HIRING.md`, optional `candidates/<id>.md`
4. Samples only if nothing else: ship path under product fixtures/hiring

Read every file or MCP payload you will cite. Never call Ashby write tools (`ashby_change_stage`, `ashby_create_note`); dispositions go through `moks commit` / `moks push`.

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
- 30/60/90 or interview bar (from HIRING.md scorecard if present):

## Process notes
- Stages / owners (only if in materials):

## Missing context
- [ ] ...

## Sources
- HIRING.md
```

## Rules

- Quote or paraphrase only what files support; mark gaps under Missing context
- If HIRING.md is absent or a stub, ask — do not fabricate a full JD
- Keep the brief short enough to reuse in score-candidate and draft-outreach
- After the brief, if title, level, team/HM, location, or must-haves are TBD, use the question tool for the next 2–4 gaps. Do not stop at a checklist.
