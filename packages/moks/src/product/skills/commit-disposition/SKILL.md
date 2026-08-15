---
name: commit-disposition
description: Recommend reject, offer, hire, or advance with rationale, then instruct use of moks commit/push. Never silent ATS writes. Use when deciding next stage for a candidate.
---

# commit-disposition

Recommend a hiring disposition and record it with the native `commit` / `status` / `push` tools. You never write ATS stages silently. `commit` is the audit (git). `push` is the ATS write (mock). The CLI (`moks commit` / `moks status` / `moks push`) is the same implementation.

## Allowed actions (examples)

- `advance` — move forward in process (non-adverse)
- `reject` — pass / decline (adverse)
- `offer` — extend offer (adverse)
- `hire` — confirm hire (adverse)
- `note` — record context without stage claim

Adverse actions: reject, offer, hire. Push requires `--confirm` for those.

## Before recommending

Look for `candidates/<id>.md` and cite its frontmatter `score` plus body. If the card has no score, say so and prefer running **score-candidate** first unless the user wants a `note`.

## Output format

```markdown
# Disposition: <action> · <candidate> → <role>

## Recommendation
- Action: <action>
- Rationale: ...
- Evidence: bullets with source paths (include `candidates/<id>.md` when present)

## Risks
- ...

## Record the decision (required)

Prefer the native `commit` / `status` / `push` tools (same verbs as the CLI). Do not use bash or raw `git commit`.

commit: action=<action> target_kind=candidate target_id=<id> reason="<one line>"
status
push: commit_id=<id>   (dry_run defaults true; adverse needs confirm=true)

CLI equivalent (implementation):

moks commit --action <action> --target-kind candidate --target-id <id> --reason "<one line>" --meta '{"card":"candidates/<id>.md"}'

Inspect:

moks status

Push when ready (adverse needs confirm):

moks push --commit-id <id>
moks push --commit-id <id> --confirm   # reject | offer | hire

## Do not
- Invent silent ATS stage moves
- Claim push wrote to Ashby/Greenhouse unless they ran execute `moks push`
- Skip the commit command block
- Use raw `git commit`
```

## Rules

- Prefer the native `commit` / `status` / `push` tools when the user asks you to record it
- Always end with the concrete `moks commit --action ...` command filled in for this case
- The one-liner must include `--target-kind candidate --target-id <id>` and `--meta` with the card path
- If evidence is thin, recommend gathering more context instead of adverse action
- Mention that push for adverse actions needs `--confirm`
