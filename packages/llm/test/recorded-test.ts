import { HttpRecorder } from "@opencode-ai/http-recorder"
import { test, type TestOptions } from "bun:test"
import { Effect, Layer } from "effect"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { RequestExecutor } from "../src/executor"
import { testEffect } from "./lib/effect"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "recordings")

type Body<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)

type RecordedTestsOptions = {
  readonly prefix: string
  readonly requires?: ReadonlyArray<string>
  readonly options?: HttpRecorder.RecordReplayOptions
}

type RecordedCaseOptions = {
  readonly cassette?: string
  readonly id?: string
  readonly requires?: ReadonlyArray<string>
  readonly options?: HttpRecorder.RecordReplayOptions
}

const kebab = (value: string) =>
  value
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()

const missingEnv = (names: ReadonlyArray<string>) => names.filter((name) => !process.env[name])

const cassetteName = (prefix: string, name: string, options: RecordedCaseOptions) =>
  options.cassette ?? `${prefix}/${options.id ?? kebab(name)}`

const mergeOptions = (
  base: HttpRecorder.RecordReplayOptions | undefined,
  override: HttpRecorder.RecordReplayOptions | undefined,
) => {
  if (!base) return override
  if (!override) return base
  return {
    ...base,
    ...override,
    metadata: base.metadata || override.metadata ? { ...(base.metadata ?? {}), ...(override.metadata ?? {}) } : undefined,
  }
}

export const recordedTests = (options: RecordedTestsOptions) => {
  // Scoped to this `recordedTests` group rather than module-global so two
  // describe files using different prefixes don't collide and parallelization
  // at the file level stays safe.
  const cassettes = new Set<string>()

  const run = <A, E>(
    name: string,
    caseOptions: RecordedCaseOptions,
    body: Body<A, E, RequestExecutor.Service>,
    testOptions?: number | TestOptions,
  ) => {
    const cassette = cassetteName(options.prefix, name, caseOptions)
    if (cassettes.has(cassette)) throw new Error(`Duplicate recorded cassette "${cassette}"`)
    cassettes.add(cassette)

    const layerOptions = {
      directory: FIXTURES_DIR,
      ...mergeOptions(options.options, caseOptions.options),
    }

    if (process.env.RECORD === "true") {
      if (missingEnv([...(options.requires ?? []), ...(caseOptions.requires ?? [])]).length > 0) {
        return test.skip(name, () => {}, testOptions)
      }
    } else if (!HttpRecorder.hasCassetteSync(cassette, layerOptions)) {
      return test.skip(name, () => {}, testOptions)
    }

    return testEffect(
      RequestExecutor.layer.pipe(Layer.provide(HttpRecorder.cassetteLayer(cassette, layerOptions))),
    ).live(name, body, testOptions)
  }

  const effect = <A, E>(
    name: string,
    body: Body<A, E, RequestExecutor.Service>,
    testOptions?: number | TestOptions,
  ) => run(name, {}, body, testOptions)

  effect.with = <A, E>(
    name: string,
    caseOptions: RecordedCaseOptions,
    body: Body<A, E, RequestExecutor.Service>,
    testOptions?: number | TestOptions,
  ) => run(name, caseOptions, body, testOptions)

  return { effect }
}
