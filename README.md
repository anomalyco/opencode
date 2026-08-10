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

## Hiring quickstart (headless)

Default agent is **`ta`** (talent acquisition). Use `--agent build` for coding.

```bash
cd packages/opencode

# sample JD / resume / scorecard (no ATS required)
FIXTURES=src/product/fixtures/hiring

bun run --conditions=browser src/index.ts run --agent ta \
  -f "$FIXTURES/jd.md" -f "$FIXTURES/resume.md" -f "$FIXTURES/scorecard.md" \
  "Score this candidate using the score-candidate skill"
```

Built-in skills: `req-context`, `score-candidate`, `draft-outreach`, `propose-disposition`.  
Fixtures + copy-paste commands: [`packages/opencode/src/product/fixtures/hiring/README.md`](packages/opencode/src/product/fixtures/hiring/README.md).

Record a disposition (receipts only — no ATS write):

```bash
bun run --conditions=browser src/index.ts propose --action advance \
  --target-kind candidate --target-id jordan-lee \
  --reason "strong event + postgres signal"

# weekly decision signal (local receipts; "real req" is still a human judgment)
bun run --conditions=browser src/index.ts activity --days 7
```

### Scriptable / headless

Same verbs; add `--json` for machine-readable stdout. Full contract: [`packages/opencode/src/product/headless.md`](packages/opencode/src/product/headless.md).

```bash
# Decision receipts (apply exit 2 = needs_confirm)
moks propose --action note --json
moks status --json
moks apply --proposal-id dec_… --json
moks apply --proposal-id dec_… --confirm --json

# Agent NDJSON events (--json ≡ --format json); --auto for CI permissions
moks run --json --agent ta -f jd.md -f resume.md -- "Score this candidate"
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
