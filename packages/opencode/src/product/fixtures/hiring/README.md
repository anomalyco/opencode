# Hiring fixtures (local loop)

Fake eng-TA sample so moks can run req → score → outreach → disposition without a live ATS. Remote/ATS later.

cwd is the requisition. `HIRING.md` is the constitution. `candidates/*.md` are working copies (frontmatter: `stage` / `score` / `source` / `ats_id`). **git commit** is the audit. **`moks push`** is the ATS write (local/mock).

| File | Contents |
|------|----------|
| `HIRING.md` | Senior Backend Engineer req + scorecard (Northline Analytics) |
| `candidates/jordan-lee.md` | Candidate card |

## Discovery order (skills + recruit agent)

1. Paths you pass (`moks run -f …` or @ attachments)
2. Cwd requisition: `HIRING.md`, `candidates/*.md`
3. These fixtures (reference / copy into a req dir)

## Quick start

Default agent is `recruit`.

From repo (source / no install):

```bash
cd packages/opencode
FIXTURES=src/product/fixtures/hiring

bun run --conditions=browser src/index.ts run --agent recruit \
  -f "$FIXTURES/HIRING.md" -f "$FIXTURES/candidates/jordan-lee.md" \
  "Score this candidate using the score-candidate skill"
```

Or copy fixtures into a scratch requisition:

```bash
cp packages/opencode/src/product/fixtures/hiring/HIRING.md .
mkdir -p candidates
cp packages/opencode/src/product/fixtures/hiring/candidates/jordan-lee.md candidates/

moks run --agent recruit \
  -f HIRING.md -f candidates/jordan-lee.md \
  "Score this candidate using the score-candidate skill"
```

Path constant for tests/tools: `HiringFixtures` in `packages/opencode/src/product/fixtures.ts`.

Mock-LLM E2E (no paid API): from `packages/opencode`,  
`bun test test/product/hiring-e2e.test.ts`.

Disposition: edit the candidate card, then `moks commit` (git audit) and `moks push` (ATS write, local/mock):

```bash
moks commit --action advance --target-id jordan-lee --reason "strong event + postgres"
moks push --commit-id <sha>
moks push --commit-id <sha> --confirm --execute   # reject | offer | hire
```

Scriptable (`--json`, exit codes): see [`../../headless.md`](../../headless.md).

```bash
moks push --json                    # exit 2 if needs_confirm
moks run --json --agent recruit -f HIRING.md -f candidates/jordan-lee.md -- "Score this candidate"
```

All names and companies are fictional.
