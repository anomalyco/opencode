# Session Log

## 2026-05-31 [saved]

Goal: Design integration plan — OpenCode V2 + Hermes self-improvement + openClaw channels
Decisions:

- Keep OpenCode's existing context management; do not replace with Hermes

- Hermes scope: only self-improvement (memory architecture, curation, evolution/pattern extraction) — not full agent runtime
- openClaw scope: channels, browser automation, MCP skill/channel integrations
- Integration must follow OpenCode's V2 direction: services in `packages/core`, plugins for policy/integration, Effect-first
- Explored OpenCode's full architecture: config, storage (JSON + SQLite), session loop, compaction, control plane (workspace sync), core services (AgentV2, Catalog, PluginV2)
- Analyzed Hermes via 3 parallel subagents → consolidated into `docs/architecture/hermes-learning-patterns-consolidation.md`
Rejected:
- Do NOT vendor Hermes cloud/agent runtime — only the self-improvement loop patterns
- Do NOT replace OpenCode's compaction with Hermes' trajectory compression — keep native
Open: Build full integration plan document next with concrete module placements and migration strategy

## 2026-05-31 [saved]

Goal: Rewrite integration plan after deep implementation study — no preemptive denials
Decisions:

- 5 parallel subagents analyzed plugin systems, compaction, session loop, EventV2, channel/browser/MCP inventory
- "Zero core changes" was a preemptive denial — 3 new experimental.* hooks in @opencode-ai/plugin are justified: experimental.session.step.complete, .session.error, .session.ended
- Compaction and Hermes are architecturally convergent (both use two-phase prune→compact, structured template) — no replacement. 4 small augmentations: informative tool collapse, anti-thrashing, pre-compaction hook, memory flush
- TWO plugin systems exist: PluginV2 (core, 7 hooks for model/provider) and @opencode-ai/plugin (external, 18 hooks, 6 experimental.*). Self-improvement hooks go in the latter
- Memory store in same SQLite DB with FTS5 (V2). Not a separate JSON file
- Channels as standard @opencode-ai/plugin (event + tool + auth hooks) — not a new plugin type
- Browser as built-in ToolRegistry tools with optional Playwright — not MCP server (latency argument)
- EventV2 already has 27 session events — self-improvement subscribes via existing subscribe() pattern, no new event types needed
- Plan at docs/architecture/integration-plan.md with 6 phases and specific file lists per phase
Rejected:
- No new plugin system for self-improvement (would be 3rd parallel plugin system)
- No PluginV2/core changes (hooks are for plumbing, not self-improvement)
- No compaction replacement (convergent architectures, massive cost for marginal gain)
- No separate database for memory (same SQLite DB + FTS5)
- No MCP transport for browser tools (latency > code coupling cost)
