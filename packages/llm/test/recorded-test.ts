import { NodeFileSystem } from "@effect/platform-node"
import { HttpRecorder } from "@opencode-ai/http-recorder"
import { Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { LLMClient, RequestExecutor } from "../src/route"
import type { Service as LLMClientService } from "../src/route/client"
import type { Service as RequestExecutorService } from "../src/route/executor"
import type { Service as WebSocketExecutorService } from "../src/route/transport/websocket"
import {
  recordedEffectGroup,
  type RecordedCaseOptions as RunnerCaseOptions,
  type RecordedGroupOptions,
} from "./recorded-runner"
import { webSocketCassetteLayer } from "./recorded-websocket"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "recordings")

type RecordedEnv = RequestExecutorService | WebSocketExecutorService | LLMClientService

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
    metadata: base.metadata || override.metadata ? { ...base.metadata, ...override.metadata } : undefined,
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
      const mode = recorderOptions?.mode ?? (recording ? "record" : "replay")
      const cassetteService = HttpRecorder.Cassette.fileSystem({ directory: FIXTURES_DIR }).pipe(
        Layer.provide(NodeFileSystem.layer),
      )
      const requestExecutor = RequestExecutor.layer.pipe(
        Layer.provide(
          HttpRecorder.recordingLayer(cassette, {
            ...recorderOptions,
            mode,
            metadata: recorderMetadata,
          }).pipe(Layer.provide(FetchHttpClient.layer)),
        ),
      )
      const deps = Layer.mergeAll(
        requestExecutor,
        webSocketCassetteLayer(cassette, { metadata: recorderMetadata, mode }),
      )
      return Layer.mergeAll(deps, LLMClient.layerWithWebSocket.pipe(Layer.provide(deps))).pipe(
        Layer.provide(cassetteService),
      )
    },
  })
