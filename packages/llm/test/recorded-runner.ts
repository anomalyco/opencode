import { test, type TestOptions } from "bun:test"
import { Effect, type Layer } from "effect"
import { testEffect } from "./lib/effect"
import { cassetteName, classifiedTags, matchesSelected, missingEnv, unique } from "./recorded-utils"

export type RecordedBody<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)

export type RecordedGroupOptions = {
  readonly prefix: string
  readonly provider?: string
  readonly protocol?: string
  readonly requires?: ReadonlyArray<string>
  readonly tags?: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
}

export type RecordedCaseOptions = {
  readonly cassette?: string
  readonly id?: string
  readonly provider?: string
  readonly protocol?: string
  readonly requires?: ReadonlyArray<string>
  readonly tags?: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
}

export const recordedEffectGroup = <
  R,
  E,
  Options extends RecordedGroupOptions,
  CaseOptions extends RecordedCaseOptions,
>(input: {
  readonly duplicateLabel: string
  readonly options: Options
  readonly cassetteExists: (cassette: string) => boolean
  readonly layer: (input: {
    readonly cassette: string
    readonly tags: ReadonlyArray<string>
    readonly metadata: Record<string, unknown>
    readonly recording: boolean
    readonly options: Options
    readonly caseOptions: CaseOptions
  }) => Layer.Layer<R, E>
}) => {
  const cassettes = new Set<string>()

  const run = <A, E2>(
    name: string,
    caseOptions: CaseOptions,
    body: RecordedBody<A, E2, R>,
    testOptions?: number | TestOptions,
  ) => {
    const cassette = cassetteName(input.options.prefix, name, caseOptions)
    if (cassettes.has(cassette)) throw new Error(`Duplicate ${input.duplicateLabel} "${cassette}"`)
    cassettes.add(cassette)
    const tags = unique([
      ...classifiedTags(input.options),
      ...classifiedTags({
        provider: caseOptions.provider,
        protocol: caseOptions.protocol,
        tags: caseOptions.tags,
      }),
    ])

    if (!matchesSelected({ prefix: input.options.prefix, name, cassette, tags }))
      return test.skip(name, () => {}, testOptions)

    const recording = process.env.RECORD === "true"
    if (recording) {
      if (missingEnv([...(input.options.requires ?? []), ...(caseOptions.requires ?? [])]).length > 0) {
        return test.skip(name, () => {}, testOptions)
      }
    } else if (!input.cassetteExists(cassette)) {
      return test.skip(name, () => {}, testOptions)
    }

    return testEffect(
      input.layer({
        cassette,
        tags,
        metadata: { ...input.options.metadata, ...caseOptions.metadata, tags },
        recording,
        options: input.options,
        caseOptions,
      }),
    ).live(name, body, testOptions)
  }

  const effect = <A, E2>(name: string, body: RecordedBody<A, E2, R>, testOptions?: number | TestOptions) =>
    run(name, {} as CaseOptions, body, testOptions)

  effect.with = <A, E2>(
    name: string,
    caseOptions: CaseOptions,
    body: RecordedBody<A, E2, R>,
    testOptions?: number | TestOptions,
  ) => run(name, caseOptions, body, testOptions)

  return { effect }
}
