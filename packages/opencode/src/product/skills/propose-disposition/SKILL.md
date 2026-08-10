---
name: propose-disposition
description: Recommend reject, offer, hire, or advance with rationale, then instruct use of moks propose/apply decision verbs. Never silent ATS writes. Use when deciding next stage for a candidate.
---

# propose-disposition

Recommend a hiring disposition and show how to record it with moks decision verbs. You never write ATS stages silently.

## Allowed actions (examples)

- `advance` — move forward in process (non-adverse)
- `reject` — pass / decline (adverse)
- `offer` — extend offer (adverse)
- `hire` — confirm hire (adverse)
- `note` — record context without stage claim

Adverse actions: reject, offer, hire. Apply requires `--confirm` for those.

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

moks propose --action <action> --target-kind candidate --target-id <id-or-name> --reason "<one line>"

Inspect:

moks status

Apply when ready (adverse needs confirm):

moks apply --proposal-id <id>
moks apply --proposal-id <id> --confirm   # reject | offer | hire

## Do not
- Invent silent ATS stage moves
- Claim apply wrote to Ashby/Greenhouse
- Skip the propose command block
```

## Rules

- Always end with the concrete `moks propose --action ...` command filled in for this case
- Prefer bash to run propose when the user asks you to record it
- If evidence is thin, recommend gathering more context instead of adverse action
- Mention that apply for adverse actions needs `--confirm`
