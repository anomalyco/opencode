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

const kebab = (value: string) =>
  value
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()

const missingEnv = (names: ReadonlyArray<string>) => names.filter((name) => !process.env[name])

const envList = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "")

const unique = (items: ReadonlyArray<string>) => Array.from(new Set(items))

const classifiedTags = (input: {
  readonly prefix?: string
  readonly provider?: string
  readonly protocol?: string
  readonly tags?: ReadonlyArray<string>
}) =>
  unique([
    ...(input.prefix ? [`prefix:${input.prefix}`] : []),
    ...(input.provider ? [`provider:${input.provider}`] : []),
    ...(input.protocol ? [`protocol:${input.protocol}`] : []),
    ...(input.tags ?? []),
  ])

const matchesSelected = (input: {
  readonly prefix: string
  readonly name: string
  readonly cassette: string
  readonly tags: ReadonlyArray<string>
}) => {
  const providers = envList("RECORDED_PROVIDER")
  const requiredTags = envList("RECORDED_TAGS")
  const tests = envList("RECORDED_TEST")
  const tags = input.tags.map((tag) => tag.toLowerCase())
  const names = [input.name, kebab(input.name), input.cassette].map((item) => item.toLowerCase())

  if (providers.length > 0 && !providers.some((provider) => tags.includes(`provider:${provider}`) || input.prefix.toLowerCase() === provider)) {
    return false
  }
  if (requiredTags.length > 0 && !requiredTags.every((tag) => tags.includes(tag))) return false
  if (tests.length > 0 && !tests.some((test) => names.some((name) => name.includes(test)))) return false
  return true
}

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
