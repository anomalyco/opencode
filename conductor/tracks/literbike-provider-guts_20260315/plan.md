# Track: replace opencode model routing guts with literbike

## Objective

Route all model calls through literbike modelmux at localhost:8888
instead of opencode's current per-provider fetch() calls.
Achieve this without forking opencode or splitting the repo.

## GitHub strategy

Three PRs, each standalone and mergeable:

### PR 1 (upstream opencode): snapshot retention
- Fix GHSA-xv3r-6x54-766h: prune ~/.local/share/opencode/snapshot/
- Max 5 snapshots, configurable via opencode.json
- Prune stale .db files for deleted branches
- Scope: packages/opencode/src/ only
- No literbike dependency. Purely defensive.
- File: conductor/tracks/snapshot-retention-policy_20260315/plan.md

### PR 2 (upstream opencode): literbike provider completeness
- opencode already has literbike provider stub at localhost:8888
- Expand model list dynamically from GET localhost:8888/v1/models
- Auth: none (local sidecar, no key in opencode config)
- No fork needed — just fleshing out existing stub
- Depends on: modelmux binary running (literbike side)

### PR 3 (literbike): @literbike/ai-sdk-provider npm package
- Vercel AI SDK provider shim so opencode's TypeScript layer
  can call literbike using the same interface as anthropic/openai
- Publishes to npm as @literbike/ai-sdk-provider
- opencode imports it; literbike controls the routing

## What stays in literbike (no opencode PR needed)

- All provider routing logic (keymux/dsel)
- Quota tracking, rate limiting, health state
- Anthropic x-api-key transform
- Streaming SSE passthrough
- macOS menubar icon / LaunchAgent

## Status

- [x] PR 1 scope defined (snapshot-retention-policy track)
- [ ] PR 1 implementation: find snapshot write path, add retention
- [ ] PR 2: dynamic model list from localhost:8888/v1/models
- [ ] PR 3: @literbike/ai-sdk-provider scaffold

## Avoiding the fork

opencode is MIT licensed. The provider stub is already there.
PRs 1 and 2 are non-controversial — bug fix + extending an existing stub.
If upstream rejects, ship as a patch applied at install time (patches/).
Hard fork only if upstream goes hostile or abandons the project.
