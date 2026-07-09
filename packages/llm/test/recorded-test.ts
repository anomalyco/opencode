import { HttpRecorder } from "@opencode-ai/http-recorder"
import { Layer } from "effect"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { LLMClient, RequestExecutor, WebSocketExecutor } from "../src/route"
import type { Service as LLMClientService } from "../src/route/client"
import type { Service as RequestExecutorService } from "../src/route/executor"
import type { Service as WebSocketExecutorService } from "../src/route/transport/websocket"
import {
  recordedEffectGroup,
  type RecordedCaseOptions as RunnerCaseOptions,
  type RecordedGroupOptions,
} from "./recorded-runner"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "recordings")

type RecordedEnv = RequestExecutorService | WebSocketExecutorService | LLMClientService

type RecordedTestsOptions = RecordedGroupOptions & {
  readonly options?: HttpRecorder.RecorderOptions
}

type RecordedCaseOptions = RunnerCaseOptions & {
  readonly options?: HttpRecorder.RecorderOptions
}

const mergeOptions = (
  base: HttpRecorder.RecorderOptions | undefined,
  override: HttpRecorder.RecorderOptions | undefined,
) => {
  if (!base) return override
  if (!override) return base
  return {
    ...base,
    ...override,
    metadata: base.metadata || override.metadata ? { ...base.metadata, ...override.metadata } : undefined,
    redact:
      base.redact || override.redact
        ? {
            ...base.redact,
            ...override.redact,
            headers: [...(base.redact?.headers ?? []), ...(override.redact?.headers ?? [])],
            allowRequestHeaders: [
              ...(base.redact?.allowRequestHeaders ?? []),
              ...(override.redact?.allowRequestHeaders ?? []),
            ],
            allowResponseHeaders: [
              ...(base.redact?.allowResponseHeaders ?? []),
              ...(override.redact?.allowResponseHeaders ?? []),
            ],
            queryParameters: [...(base.redact?.queryParameters ?? []), ...(override.redact?.queryParameters ?? [])],
            jsonFields: [...(base.redact?.jsonFields ?? []), ...(override.redact?.jsonFields ?? [])],
          }
        : undefined,
  }
}

export const recordedTests = (options: RecordedTestsOptions) =>
  recordedEffectGroup<RecordedEnv, never, RecordedTestsOptions, RecordedCaseOptions>({
    duplicateLabel: "recorded cassette",
    options,
    cassetteExists: (cassette) => HttpRecorder.hasCassetteSync(cassette, { directory: FIXTURES_DIR }),
    layer: ({ cassette, metadata, options, caseOptions, recording }) => {
      const recorderOptions = mergeOptions(options.options, caseOptions.options)
      const recorderMetadata = {
        ...recorderOptions?.metadata,
        ...metadata,
      }
      if (recording) {
        if (process.env.CI !== undefined) throw new Error("Unset CI before recording HTTP cassettes")
        HttpRecorder.removeCassetteSync(cassette, { directory: FIXTURES_DIR })
      }
      const requestExecutor = RequestExecutor.layer.pipe(
        Layer.provide(
          HttpRecorder.layerFetch(cassette, {
            ...recorderOptions,
            directory: FIXTURES_DIR,
            metadata: recorderMetadata,
          }),
        ),
      )
      const deps = Layer.mergeAll(requestExecutor, WebSocketExecutor.layer)
      return Layer.mergeAll(deps, LLMClient.layer.pipe(Layer.provide(deps)))
    },
  })
