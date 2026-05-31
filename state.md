# State

## Current Goal

Integration plan rewritten with informed trade-offs based on deep code study. Waiting for user review.

## Plan Status

### Phase 1 — Done

- Explored OpenCode monorepo: `packages/core`, `packages/opencode`, specs
- Explored Hermes Agent patterns → consolidated to `docs/architecture/hermes-learning-patterns-consolidation.md`

### Phase 2 — Deep Implementation Study (Done)

Read actual code instead of making assumptions:

- Plugin systems: PluginV2 (core, 7 hooks) vs @opencode-ai/plugin (external, 18 hooks, 6 experimental.*)
- EventV2 system: 27 session events across 5 categories
- Compaction: ~640 lines in compaction.ts, structurally convergent with Hermes
- Session loop: prompt.ts ~1700 lines, exact injection points mapped
- Tool system: 18 built-in tools, ToolRegistry pattern, Tool.Def type
- Bus: 54 events across 20+ source files
- MCP: 981-line service with OAuth, remote/local transports
- No channel or browser code exists (confirmed)

### Phase 3 — Parallel Deep Analysis (Done)

Dispatched 4 parallel subagents:

1. Plugin System Architect — plugin architecture analysis
2. Compaction Specialist — compaction vs Hermes comparison
3. Backend Architect — session loop injection points
4. EventV2 Architect — event system & cross-session access

### Phase 4 — Rewrite Plan (Done)

Rewrote `docs/architecture/integration-plan.md` with informed trade-offs:

- Dropped "zero core changes" preemptive denial
- Added 3 new experimental.* hooks (justified by analysis)
- Kept compaction as-is + 4 augmentations (justified by convergence finding)
- Channels as @opencode-ai/plugin (not new plugin system)
- Browser as built-in tools (not MCP — justified by latency analysis)
- Memory in same SQLite DB with FTS5 V2 (not separate JSON)
- 6 implementation phases with specific file lists

## Key Findings

### Plugin Decision

- **Self-improvement hooks go in @opencode-ai/plugin** (not PluginV2/core, not a third system)
- 3 new hooks: `experimental.session.step.complete`, `.session.error`, `.session.ended`

### Compaction Decision

- **Keep as-is.** Architecturally convergent with Hermes. 4 small augmentations.

### Channel Decision

- **Standard @opencode-ai/plugin.** `event` + `tool` + `auth` hooks are sufficient.

### Browser Decision

- **Built-in tools in ToolRegistry.** Playwright as optional dep. WorkspaceAdapter for sandbox variant.

## Open Issues

- Awaiting user review of rewritten plan
