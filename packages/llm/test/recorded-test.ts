import { HttpRecorder } from "@opencode-ai/http-recorder"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { runtimeLayer, type RuntimeEnv } from "./lib/http"
import { recordedEffectGroup, type RecordedCaseOptions as RunnerCaseOptions, type RecordedGroupOptions } from "./recorded-runner"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "recordings")

type RecordedEnv = RuntimeEnv

type RecordedTestsOptions = RecordedGroupOptions & {
  readonly options?: HttpRecorder.RecordReplayOptions
}

type RecordedCaseOptions = RunnerCaseOptions & {
  readonly options?: HttpRecorder.RecordReplayOptions
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

export const recordedTests = (options: RecordedTestsOptions) =>
  recordedEffectGroup<RecordedEnv, never, RecordedTestsOptions, RecordedCaseOptions>({
    duplicateLabel: "recorded cassette",
    options,
    cassetteExists: (cassette) => fs.existsSync(HttpRecorder.cassettePath(cassette, FIXTURES_DIR)),
    layer: ({ cassette, metadata, options, caseOptions }) => {
      const recorderOptions = mergeOptions(options.options, caseOptions.options)
      return runtimeLayer(HttpRecorder.cassetteLayer(cassette, {
        directory: FIXTURES_DIR,
        ...recorderOptions,
        metadata: {
          ...recorderOptions?.metadata,
          ...metadata,
        },
      }))
    },
  })
