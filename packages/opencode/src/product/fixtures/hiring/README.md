# Hiring fixtures (local loop)

Fake eng-TA sample materials so moks can run req → score → outreach → disposition without ATS.

| File | Contents |
|------|----------|
| `jd.md` | Senior Backend Engineer req (Northline Analytics) |
| `resume.md` | Candidate Jordan Lee |
| `scorecard.md` | Simple 1–5 dimension card |

## Discovery order (skills + TA agent)

1. Paths you pass (`moks run -f …` or @ attachments)
2. Cwd: `jd.md`, `resume.md`, `scorecard.md`
3. Workspace: `.moks/req/jd.md`, `.moks/req/resume.md`, `.moks/req/scorecard.md`
4. These samples (reference / copy)

## Quick start

Default agent is `ta`. Use `--agent build` only when you want the coding agent.

From repo (source / no install):

```bash
cd packages/opencode
FIXTURES=src/product/fixtures/hiring

bun run --conditions=browser src/index.ts run --agent ta \
  -f "$FIXTURES/jd.md" -f "$FIXTURES/resume.md" -f "$FIXTURES/scorecard.md" \
  "Score this candidate using the score-candidate skill"
```

Or copy fixtures into a scratch dir / moks workspace:

```bash
cp packages/opencode/src/product/fixtures/hiring/*.md .
# or
mkdir -p .moks/req && cp packages/opencode/src/product/fixtures/hiring/{jd,resume,scorecard}.md .moks/req/

moks run --agent ta \
  -f jd.md -f resume.md -f scorecard.md \
  "Score this candidate using the score-candidate skill"
```

Path constant for tests/tools: `HiringFixtures` in `packages/opencode/src/product/fixtures.ts`.

Mock-LLM E2E (no paid API): from `packages/opencode`,  
`bun test test/product/hiring-e2e.test.ts`.

Disposition (receipts only, no ATS write):

```bash
moks propose --action advance --target-kind candidate --target-id jordan-lee --reason "strong event + postgres signal"
moks status
moks apply --proposal-id <id>          # non-adverse
moks apply --proposal-id <id> --confirm  # reject | offer | hire
```

All names and companies are fictional.
