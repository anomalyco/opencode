export * as TaskGraph from "./task-graph"

import { Effect, Schema } from "effect"

/**
 * TaskGraph — Fase 3 (agent-first). Process-local DAG orchestrator for fan-out
 * work planned from session todos and executed through TaskTool/BackgroundJob.
 *
 * Entries are intentionally not durable: the graph is validated and drained
 * in memory. Durable todo rows (`session/todo`) stay the record of intent;
 * this module is the execution order over a snapshot of that intent.
 *
 * Semantics:
 * - `layers` validates (duplicate ids, unknown dependencies, cycles) and
 *   groups ids into parallel waves. It is synchronous and throws the typed
 *   errors below; `run` converts them into typed failures.
 * - `run` executes one wave at a time, nodes within a wave concurrently.
 *   Expected node failures record as `failed` and skip dependents with
 *   `dependency-failed`. Defects and interrupts still propagate and abort
 *   the drain. `failFast` skips every remaining wave after the first failure.
 */

export interface Node {
  readonly id: string
  readonly dependsOn?: readonly string[]
}

export interface Spec<A, E> extends Node {
  readonly run: Effect.Effect<A, E>
}

export type Outcome<A, E> =
  | { readonly status: "completed"; readonly value: A }
  | { readonly status: "failed"; readonly error: E }
  | { readonly status: "skipped"; readonly reason: string }

export interface RunOptions {
  readonly concurrency?: number | "unbounded"
  readonly failFast?: boolean
}

export class DuplicateNodeError extends Schema.TaggedErrorClass<DuplicateNodeError>()("TaskGraphDuplicateNode", {
  id: Schema.String,
}) {}

export class UnknownDependencyError extends Schema.TaggedErrorClass<UnknownDependencyError>()(
  "TaskGraphUnknownDependency",
  {
    id: Schema.String,
    dependency: Schema.String,
  },
) {}

export class CycleError extends Schema.TaggedErrorClass<CycleError>()("TaskGraphCycle", {
  cycle: Schema.Array(Schema.String),
}) {}

export const layers = (nodes: readonly Node[]): string[][] => {
  requireUnique(nodes)
  requireKnown(nodes)
  return kahn(nodes)
}

// Plain function instead of Effect.fn: Effect.fn collapses generic inference
// for this body (nested forEach overloads resolve to never), while Effect.gen
// keeps full A/E/R inference.
export function run<A, E>(specs: readonly Spec<A, E>[], options?: RunOptions) {
  return Effect.gen(function* () {
    // layers only throws the three errors below, so narrowing the unknown cause is safe.
    const waves = yield* Effect.try({
      try: () => layers(specs),
      catch: (cause) => cause as DuplicateNodeError | UnknownDependencyError | CycleError,
    })
    const byId = new Map(specs.map((spec) => [spec.id, spec] as const))
    const outcomes = new Map<string, Outcome<A, E>>()
    for (const wave of waves) {
      if (options?.failFast === true && hasFailure(outcomes)) {
        wave.forEach((id) => outcomes.set(id, { status: "skipped", reason: "fail-fast" }))
        continue
      }
      const eligible: Spec<A, E>[] = []
      wave.forEach((id) => {
        const spec = byId.get(id)
        if (spec === undefined) return
        if ((spec.dependsOn ?? []).every((dependency) => outcomes.get(dependency)?.status === "completed")) {
          eligible.push(spec)
          return
        }
        outcomes.set(id, { status: "skipped", reason: "dependency-failed" })
      })
      const settled = yield* Effect.forEach(eligible, (spec) => settle(spec), {
        concurrency: options?.concurrency ?? "unbounded",
      })
      settled.forEach(([id, outcome]) => outcomes.set(id, outcome))
    }
    return outcomes
  })
}

function settle<A, E>(spec: Spec<A, E>) {
  return spec.run.pipe(
    Effect.map((value) => [spec.id, { status: "completed", value } as Outcome<A, E>] as const),
    Effect.catch((error) => Effect.succeed([spec.id, { status: "failed", error } as Outcome<A, E>] as const)),
  )
}
function hasFailure<A, E>(outcomes: ReadonlyMap<string, Outcome<A, E>>) {
  return [...outcomes.values()].some((outcome) => outcome.status === "failed")
}

function requireUnique(nodes: readonly Node[]) {
  const seen = new Set<string>()
  nodes.forEach((node) => {
    if (seen.has(node.id)) throw new DuplicateNodeError({ id: node.id })
    seen.add(node.id)
  })
}

function requireKnown(nodes: readonly Node[]) {
  const ids = new Set(nodes.map((node) => node.id))
  nodes.forEach((node) =>
    (node.dependsOn ?? []).forEach((dependency) => {
      if (!ids.has(dependency)) throw new UnknownDependencyError({ id: node.id, dependency })
    }),
  )
}

function kahn(nodes: readonly Node[]) {
  const remaining = new Map(nodes.map((node) => [node.id, new Set(node.dependsOn ?? [])]))
  const waves: string[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([id]) => id)
      .toSorted()
    if (ready.length === 0) throw new CycleError({ cycle: [...remaining.keys()].toSorted() })
    waves.push(ready)
    ready.forEach((id) => remaining.delete(id))
    remaining.forEach((dependencies) => ready.forEach((id) => dependencies.delete(id)))
  }
  return waves
}
