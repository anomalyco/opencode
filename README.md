# moks

TUI-first agent harness for engineering TAs — score candidates, draft outreach, and run hiring loops from the terminal.

**Based on [OpenCode](https://github.com/anomalyco/opencode).** MIT licensed. **Not** officially affiliated with OpenCode or Anomaly.

## Install (from source)

Requires [Bun](https://bun.sh). Binary releases are not ready yet.

```bash
git clone https://github.com/artemysone/moks.git
cd moks
bun install
bun dev
```

`bun dev` starts the TUI from `packages/opencode`. From that package you can also run:

```bash
cd packages/opencode
bun dev
# or
bun run --conditions=browser src/index.ts
```

Default branch is `dev`. Day-to-day workflow is Bun (`bun install` / `bun dev`) — not npm/pnpm as the primary path.

## Hiring quickstart

Default agent is **`recruit`**. Use `--agent build` for the hidden coding escape hatch.

TUI first:

```bash
bun dev
# then /init → add resume → /score-candidate → moks commit → moks push
```

Headless fixture run:

```bash
cd packages/opencode

# sample HIRING.md + candidate card (no ATS required)
FIXTURES=src/product/fixtures/hiring

bun run --conditions=browser src/index.ts run --agent recruit \
  -f "$FIXTURES/HIRING.md" -f "$FIXTURES/candidates/jordan-lee.md" \
  "Score this candidate using the score-candidate skill"
```

Built-in skills: `req-context`, `score-candidate`, `draft-outreach`, `commit-disposition`.  
Fixtures + copy-paste commands: [`packages/opencode/src/product/fixtures/hiring/README.md`](packages/opencode/src/product/fixtures/hiring/README.md).

Record a disposition (git commit is the audit; `push --execute` writes the mock ATS):

```bash
bun run --conditions=browser src/index.ts commit --action advance \
  --target-kind candidate --target-id jordan-lee \
  --reason "strong event + postgres signal"

# weekly decision signal (git log; "real req" is still a human judgment)
bun run --conditions=browser src/index.ts activity --days 7
```

### Scriptable / headless

Same verbs; add `--json` for machine-readable stdout. Full contract: [`packages/opencode/src/product/headless.md`](packages/opencode/src/product/headless.md).

```bash
# Git audit + ATS push (push exit 2 = needs_confirm)
moks commit --action note --target-id jordan-lee --json
moks status --json
moks push --commit-id <sha> --json
moks push --commit-id <sha> --confirm --execute --json

# Agent NDJSON events (--json ≡ --format json); --auto for CI permissions
moks run --json --agent recruit -f HIRING.md -f candidates/jordan-lee.md -- "Score this candidate"
```

### Optional: install script

`./install` is a moks-branded stub. It does **not** download upstream OpenCode binaries. Prefer source install above until moks ships its own releases.

## Docs

| Doc | What |
|-----|------|
| [docs/ROADMAP.md](docs/ROADMAP.md) | v0 product backlog |
| [docs/FORK.md](docs/FORK.md) | Fork facts, remotes, affiliation |
| [docs/gtm.html](docs/gtm.html) | Product strategy / GTM |

## License

MIT — see [LICENSE](LICENSE). Upstream OpenCode copyright retained; moks adds copyright for fork work.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This repo is the **moks** product fork (`artemysone/moks`), not upstream OpenCode.
