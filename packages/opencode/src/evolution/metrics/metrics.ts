import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { Config } from "@/config/config"
import { EvolutionStorageError, toEvolutionStorageError } from "@/evolution/error"
import path from "path"

export interface MetricPoint {
  name: string
  value: number
  tags: Record<string, string>
  timestamp: number
}

export interface MetricsSummary {
  count: number
  min: number
  max: number
  mean: number
  lastValue: number
}

export interface Interface {
  readonly record: (name: string, value: number, tags?: Record<string, string>) => Effect.Effect<void, EvolutionStorageError>
  readonly query: (name: string, from?: number, to?: number) => Effect.Effect<MetricPoint[], EvolutionStorageError>
  readonly summary: (name: string) => Effect.Effect<MetricsSummary | undefined, EvolutionStorageError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionMetrics") {}

export function makeMetricsStore(baseDir: string, fs: FSUtil.Interface): Interface {
  const filePath = path.join(baseDir, ".opencode", "evolution", "metrics.json")

  const readAll = (): Effect.Effect<MetricPoint[], EvolutionStorageError> =>
    fs.readFileStringSafe(filePath).pipe(
      Effect.map((raw) => {
        if (!raw) return []
        try {
          return JSON.parse(raw) as MetricPoint[]
        } catch {
          return []
        }
      }),
      Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "read", filePath))),
    )

  const writeAll = (points: MetricPoint[]): Effect.Effect<void, EvolutionStorageError> =>
    fs.writeWithDirs(filePath, JSON.stringify(points)).pipe(
      Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", filePath))),
    )

  const record = Effect.fn("Metrics.record")(function* (name: string, value: number, tags?: Record<string, string>) {
    const existing = yield* readAll()
    existing.push({ name, value, tags: tags ?? {}, timestamp: Date.now() })
    yield* writeAll(existing)
  })

  const query = Effect.fn("Metrics.query")(function* (name: string, from?: number, to?: number) {
    const all = yield* readAll()
    return all.filter((p) => {
      if (p.name !== name) return false
      if (from !== undefined && p.timestamp < from) return false
      if (to !== undefined && p.timestamp > to) return false
      return true
    })
  })

  const summary = Effect.fn("Metrics.summary")(function* (name: string) {
    const points = yield* query(name)
    if (points.length === 0) return undefined as MetricsSummary | undefined
    const values = points.map((p) => p.value)
    const sum = values.reduce((a, b) => a + b, 0)
    return {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      mean: sum / values.length,
      lastValue: values[values.length - 1],
    }
  })

  return { record, query, summary }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const state = yield* InstanceState.make(
      Effect.fn("EvolutionMetrics.state")(function* (ctx) {
        const cfg = yield* config.get()
        if (!cfg.evolution?.enabled) return undefined as Interface | undefined
        return makeMetricsStore(ctx.worktree, fs)
      }),
    )
    const getStore = Effect.fn("EvolutionMetrics.get")(function* () {
      const s = yield* InstanceState.get(state)
      if (!s) return yield* Effect.die(new Error("Metrics not available (evolution disabled)"))
      return s
    })
    return Service.of({
      record: (name, value, tags) => getStore().pipe(Effect.flatMap((s) => s.record(name, value, tags))),
      query: (name, from, to) => getStore().pipe(Effect.flatMap((s) => s.query(name, from, to))),
      summary: (name) => getStore().pipe(Effect.flatMap((s) => s.summary(name))),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
)

export * as EvolutionMetrics from "./metrics"
