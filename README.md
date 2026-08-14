# moks

The agent harness for engineering talent acquisition.

moks is to hiring what a coding agent is to software: same workplace shape — workspace, plan, tools, review, push — pointed at requisitions instead of repos. Local first. Remote later.

A requisition is a directory. `HIRING.md` is the constitution. `candidates/<id>.md` are working copies. `moks commit` is the git audit. `moks push` is the write (local/mock for now). `.moks/` is cache only.

**Based on [OpenCode](https://github.com/anomalyco/opencode).** MIT licensed. **Not** officially affiliated with OpenCode or Anomaly.

| Coding | moks |
|--------|------|
| Repo | This directory is the req |
| `AGENTS.md` | `HIRING.md` |
| GitHub | ATS (later) |
| Diff | Local card + constitution changes |
| Commit / push | `moks commit` / `moks push` |
| PR review | `/review` packet review |
| Build agent | `recruit` (`build` stays hidden) |

## Install (from source)

Requires [Bun](https://bun.sh). Binary releases are not ready yet.

```bash
git clone https://github.com/artemysone/moks.git
cd moks
bun install
bun dev
```

`bun dev` starts the TUI from `packages/moks`. From that package you can also run:

```bash
cd packages/moks
bun dev
# or
bun run --conditions=browser src/index.ts
```

Default branch is `dev`. Day-to-day workflow is Bun (`bun install` / `bun dev`) — not npm/pnpm as the primary path.

## Hiring loop

Default agent is **`recruit`**.

```bash
bun dev
# /init → attach a resume → score-candidate → /review → moks commit → moks push
```

Headless fixture run (no ATS required):

```bash
cd packages/moks

FIXTURES=src/product/fixtures/hiring

bun run --conditions=browser src/index.ts run --agent recruit \
  -f "$FIXTURES/HIRING.md" -f "$FIXTURES/candidates/jordan-lee.md" \
  "Score this candidate using the score-candidate skill"
```

Built-in skills: `req-context`, `score-candidate`, `draft-outreach`, `commit-disposition`.  
Fixtures: [`packages/moks/src/product/fixtures/hiring/README.md`](packages/moks/src/product/fixtures/hiring/README.md).

Record a disposition (git commit is the audit; `push --execute` writes the mock ATS):

```bash
bun run --conditions=browser src/index.ts commit --action advance \
  --target-kind candidate --target-id jordan-lee \
  --reason "strong event + postgres signal"

bun run --conditions=browser src/index.ts activity --days 7
```

### Scriptable / headless

Same verbs; add `--json` for machine-readable stdout. Full contract: [`packages/moks/src/product/headless.md`](packages/moks/src/product/headless.md).

```bash
moks commit --action note --target-id jordan-lee --json
moks status --json
moks push --commit-id <sha> --json
moks push --commit-id <sha> --confirm --execute --json

moks run --json --agent recruit -f HIRING.md -f candidates/jordan-lee.md -- "Score this candidate"
```

### Optional: install script

`./install` is a moks-branded stub. It does **not** download upstream OpenCode binaries. Prefer source install above until moks ships its own releases.

## Docs

| Doc | What |
|-----|------|
| [docs/gtm.html](docs/gtm.html) | Product strategy / GTM |
| [AGENTS.md](AGENTS.md) | Constitution for work in this repo |

## License

MIT — see [LICENSE](LICENSE). Upstream OpenCode copyright retained; moks adds copyright for fork work.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This repo is the **moks** product fork (`artemysone/moks`), not upstream OpenCode.
