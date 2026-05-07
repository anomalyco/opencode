import { HttpRecorder } from "@opencode-ai/http-recorder"
import { test, type TestOptions } from "bun:test"
import { Effect } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { testEffect } from "./lib/effect"
import { runtimeLayer, type RuntimeEnv } from "./lib/http"
import { cassetteName, classifiedTags, matchesSelected, missingEnv, unique } from "./recorded-utils"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "recordings")

type Body<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)
type RecordedEnv = RuntimeEnv

type RecordedTestsOptions = {
  readonly prefix: string
  readonly provider?: string
  readonly protocol?: string
  readonly requires?: ReadonlyArray<string>
  readonly options?: HttpRecorder.RecordReplayOptions
  readonly tags?: ReadonlyArray<string>
}

type RecordedCaseOptions = {
  readonly cassette?: string
  readonly id?: string
  readonly provider?: string
  readonly protocol?: string
  readonly requires?: ReadonlyArray<string>
  readonly options?: HttpRecorder.RecordReplayOptions
  readonly tags?: ReadonlyArray<string>
}

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
    body: Body<A, E, RecordedEnv>,
    testOptions?: number | TestOptions,
  ) => {
    const cassette = cassetteName(options.prefix, name, caseOptions)
    if (cassettes.has(cassette)) throw new Error(`Duplicate recorded cassette "${cassette}"`)
    cassettes.add(cassette)
    const tags = unique([
      ...classifiedTags(options),
      ...classifiedTags({
        provider: caseOptions.provider,
        protocol: caseOptions.protocol,
        tags: caseOptions.tags,
      }),
    ])

    if (!matchesSelected({ prefix: options.prefix, name, cassette, tags })) return test.skip(name, () => {}, testOptions)

    const recorderOptions = mergeOptions(options.options, caseOptions.options)
    const layerOptions = {
      directory: FIXTURES_DIR,
      ...recorderOptions,
      metadata: {
        ...recorderOptions?.metadata,
        tags,
      },
    }

    if (process.env.RECORD === "true") {
      if (missingEnv([...(options.requires ?? []), ...(caseOptions.requires ?? [])]).length > 0) {
        return test.skip(name, () => {}, testOptions)
      }
    } else if (!fs.existsSync(HttpRecorder.cassettePath(cassette, FIXTURES_DIR))) {
      return test.skip(name, () => {}, testOptions)
    }

    return testEffect(runtimeLayer(HttpRecorder.cassetteLayer(cassette, layerOptions))).live(name, body, testOptions)
  }

  const effect = <A, E>(
    name: string,
    body: Body<A, E, RecordedEnv>,
    testOptions?: number | TestOptions,
  ) => run(name, {}, body, testOptions)

  effect.with = <A, E>(
    name: string,
    caseOptions: RecordedCaseOptions,
    body: Body<A, E, RecordedEnv>,
    testOptions?: number | TestOptions,
  ) => run(name, caseOptions, body, testOptions)

  return { effect }
}
