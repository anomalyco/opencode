---
name: commit-disposition
description: Recommend reject, offer, hire, or advance with rationale, then instruct use of moks commit/push decision verbs. Never silent ATS writes. Use when deciding next stage for a candidate.
---

# commit-disposition

Recommend a hiring disposition and show how to record it with moks decision verbs. You never write ATS stages silently.

## Allowed actions (examples)

- `advance` — move forward in process (non-adverse)
- `reject` — pass / decline (adverse)
- `offer` — extend offer (adverse)
- `hire` — confirm hire (adverse)
- `note` — record context without stage claim

Adverse actions: reject, offer, hire. Push requires `--confirm` for those.

## Output format

```markdown
# Disposition: <action> · <candidate> → <role>

## Recommendation
- Action: <action>
- Rationale: ...
- Evidence: bullets with source paths

## Risks
- ...

## Record the decision (required)

Run (dry-run default):

moks commit --action <action> --target-kind candidate --target-id <id-or-name> --reason "<one line>"

Inspect:

moks status

Push when ready (adverse needs confirm):

moks push --commit-id <id>
moks push --commit-id <id> --confirm   # reject | offer | hire

## Do not
- Invent silent ATS stage moves
- Claim push wrote to Ashby/Greenhouse
- Skip the commit command block
```

## Rules

- Always end with the concrete `moks commit --action ...` command filled in for this case
- Prefer bash to run commit when the user asks you to record it
- If evidence is thin, recommend gathering more context instead of adverse action
- Mention that push for adverse actions needs `--confirm`
