/**
 * Single-namespace barrel for the monitor module.
 *
 * Per `packages/opencode/AGENTS.md`, a directory that re-exports its
 * siblings as a namespace uses `index.ts` (the `if the file is an
 * index.ts` rule) with `export * as Monitor from "."`.
 *
 * Siblings stay accessible via direct paths (`@/monitor/kanban`,
 * `@/monitor/health`, …) for tree-shaking; this barrel is the few call
 * sites that need the namespace form (`Monitor.Service`,
 * `Monitor.defaultLayer`).
 */

export { Service, layer, defaultLayer, type Interface } from "./service"
export * as Monitor from "."
