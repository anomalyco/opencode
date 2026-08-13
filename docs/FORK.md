# Fork Facts

moks is a specialized hard fork of the OpenCode source (`anomalyco/opencode` → `artemysone/moks`). The hard fork is operational.

## Three different “OpenCodes”

| | |
|--|--|
| **moks** | This repo / product (TA harness). What we ship. |
| **OpenCode upstream** | `anomalyco/opencode` — source lineage only. |
| **OpenCode (installed)** | The coding agent used to *build* moks. Not the product. |

`packages/opencode` is a folder name inside **moks**, not the installed agent.

| Remote | Points at | Role |
|--------|-----------|------|
| `origin` | `artemysone/moks` | where we push |
| `upstream` | `anomalyco/opencode` | reference only — do not merge |

## Keep in mind

1. **Hard fork.** Do not merge `upstream/dev`. Cherry-pick a provider/kernel fix only if needed.

2. **Company packages are pruned.** desktop, console, web, app, enterprise, stats, slack, storybook, session-ui, ui, SST, and infra are gone. Do not bring them back.

3. **Product path** is `packages/opencode` + `packages/core` + `packages/tui`, plus their real dependencies. That is the TA harness.

4. **Keep `@opencode-ai/*` package names** until a later deliberate rename.

5. **License stays MIT** — keep upstream copyright notices; add ours for new work. Don’t strip `LICENSE`.

6. **Do not ship as OpenCode** — not their npm, brew, or docker names. No official affiliation.

7. **Their secrets/infra aren’t ours** — SST, AWS, console, zen need our own accounts. Ignore cloud packages.

8. **Bun, not pnpm** — `bun install` / `bun dev`. Default branch is `dev`.
