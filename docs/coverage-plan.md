# Coverage, observability & cache plan (audit track)

This is the actionable side of the audit's quality findings, applied to opencode. It is deliberately
a **plan over a real baseline**, not a claim that everything is already covered.

## Coverage

Source of truth: [`coverage-baseline.md`](./coverage-baseline.md) (regenerate with
`bun run script/coverage-baseline.ts`). At baseline, **13/29** workspace packages contain tests;
`core` (131) and `opencode` (239) are well covered. The backlog is the **16 packages with zero
test files**, prioritized by blast radius:

- **First (public/extension surfaces):** `@opencode-ai/plugin`, `@opencode-ai/sdk`,
  `@opencode-ai/server`, `@opencode-ai/function`, `@opencode-ai/cli`.
- **Next (apps/services):** `@opencode-ai/web`, `@opencode-ai/stats-server`, `@opencode-ai/stats-app`,
  `@opencode-ai/console-*`, `@opencode-ai/effect-sqlite-node`, `@opencode-ai/script`,
  `@opencode-ai/storybook`, `@opencode-ai/slack`.

Per package: add a `bunfig.toml` (mirroring `packages/{tui,app,cli,opencode}`) so `bun test` runs
there, then a `test/` dir. Follow the Effect testing patterns (`testEffect`, `it.live`) from
`.opencode/skills/effect/SKILL.md`. Verify a package with `bun run script/verify.ts <package>`.

## Observability

opencode core already depends on `@effect/opentelemetry`, so the audited platform's "zero
observability" does **not** apply to the core — tracing exists. The remaining gap was in tooling and
skills emitting **structured** signals. That is now in place: `script/verify.ts` and
`script/skills/vetter.ts` emit structured JSON evidence (`--json`) that both humans and the agent can
consume, and `commit-trailer.ts` turns it into durable commit metadata.

## Cache

The audit's "zero cache everywhere" is addressed for the skill ecosystem by
[`.opencode/skills/lib/cache.ts`](../.opencode/skills/lib/cache.ts) (`fileCache` + `memoize`, tested),
used by the `report-builder` pilot to memoize its pure render by input hash. New skills reuse it
instead of recomputing.
