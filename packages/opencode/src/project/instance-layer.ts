import { InstanceStore } from "./instance-store"

// `InstanceStore.layer` requires `InstanceBootstrap.Service` and `Project.Service`.
// Production callers provide `InstanceBootstrap.defaultLayer` and `Project.defaultLayer`
// alongside this layer (see `routes/instance/httpapi/server.ts:createRoutes`,
// `worktree/index.ts`, `effect/app-runtime.ts`). Keeping the bootstrap external
// rather than baking it in here (a) lets tests override `InstanceBootstrap` with a
// stub without rebuilding the full layer graph, and (b) — critically — keeps this a
// stable module-level Layer reference so the shared process memoMap materializes a
// single `InstanceStore.Service` per directory across the TCP listener and the
// in-process webHandler pipelines. The previous `Layer.unwrap(Effect.promise(...))`
// form built a fresh inner layer on every build, defeating memoization and yielding
// two InstanceStore.Service per directory — which wedged the Question tool on submit.
export const layer = InstanceStore.layer

export * as InstanceLayer from "./instance-layer"
