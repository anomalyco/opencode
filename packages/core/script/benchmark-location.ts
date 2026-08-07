import path from "path"
import { Effect, Logger } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Database } from "../src/database/database"
import { Bus } from "../src/bus"
import { SdkPlugins } from "../src/plugin/sdk"
import { Location } from "../src/location"
import { LocationServiceMap } from "../src/location-service-map"
import { AbsolutePath } from "../src/schema"

const args = process.argv.slice(2)
const iterationsIndex = args.indexOf("--iterations")
const iterations = iterationsIndex === -1 ? 10 : Number(args[iterationsIndex + 1])
const directory = args.find((arg, index) => !arg.startsWith("--") && index !== iterationsIndex + 1) ?? process.cwd()

if (!Number.isInteger(iterations) || iterations < 1) {
  console.error("--iterations must be a positive integer")
  process.exit(1)
}

const ref = Location.Ref.make({ directory: AbsolutePath.make(path.resolve(directory)) })
const layer = AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]),
)

const measure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const start = performance.now()
    yield* effect
    return performance.now() - start
  })

const stats = (samples: ReadonlyArray<number>) => {
  const sorted = samples.toSorted((a, b) => a - b)
  const percentile = (value: number) => sorted[Math.min(Math.ceil(sorted.length * value) - 1, sorted.length - 1)]
  return {
    mean: samples.reduce((total, sample) => total + sample, 0) / samples.length,
    min: sorted[0] ?? 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? 0,
  }
}

const print = (name: string, samples: ReadonlyArray<number>) => {
  const result = stats(samples)
  console.log(
    `${name.padEnd(12)} mean ${result.mean.toFixed(2)} ms  min ${result.min.toFixed(2)} ms  p50 ${result.p50.toFixed(2)} ms  p95 ${result.p95.toFixed(2)} ms  max ${result.max.toFixed(2)} ms`,
  )
}

const program = Effect.gen(function* () {
  const locations = yield* LocationServiceMap.Service
  const load = locations.contextEffect(ref).pipe(Effect.scoped)

  const first = yield* measure(load)
  const cached = yield* Effect.forEach(Array.from({ length: iterations }), () => measure(load))
  const cold = yield* Effect.forEach(Array.from({ length: iterations }), () =>
    locations.invalidate(ref).pipe(Effect.andThen(measure(load))),
  )

  console.log(`Location: ${ref.directory}`)
  console.log(`Iterations: ${iterations}`)
  print("first", [first])
  print("cached", cached)
  print("cold", cold)
}).pipe(Effect.scoped, Effect.provide(layer), Effect.provide(Logger.layer([])))

await Effect.runPromise(program)
