export * as DownloadTool from "./download"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Download } from "../download"
import { makeLocationNode } from "../effect/app-node"
import { LayerNodePlatform } from "../effect/app-node-platform"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "download"

export const description = `Download a large HTTP(S) file directly to disk with durable progress reporting.

Use this tool instead of webfetch, bash, curl, or wget when a file may be large or take more than a few seconds. The host streams bytes without returning control to the model, so do not poll or narrate progress. The next model turn starts only after the download completes or fails.`

export const Input = Schema.Struct({
  url: Schema.String.annotate({ description: "HTTP or HTTPS URL of the file to download" }),
  filePath: Schema.String.annotate({
    description:
      "Destination file path. Relative paths resolve within the active Location; external absolute paths require approval.",
  }),
  sha256: Schema.String.pipe(Schema.optional).annotate({
    description: "Optional expected lowercase or uppercase SHA-256 checksum",
  }),
  overwrite: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Replace an existing destination file. Defaults to false.",
  }),
})

const Progress = Schema.Struct({
  phase: Schema.Literals(["starting", "downloading", "verifying", "completed"]),
  url: Schema.String,
  filePath: Schema.String,
  receivedBytes: Schema.Number,
  totalBytes: Schema.Number.pipe(Schema.optional),
  percent: Schema.Number.pipe(Schema.optional),
  bytesPerSecond: Schema.Number,
  elapsedMs: Schema.Number,
})

export const Output = Schema.Struct({
  download: Progress,
  sha256: Schema.String,
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const http = yield* HttpClient.HttpClient
    const fs = yield* FSUtil.Service
    const mutation = yield* LocationMutation.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: `Downloaded ${output.download.receivedBytes} bytes to ${output.download.filePath}. SHA-256: ${output.sha256}`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              const parsed = yield* Effect.try({ try: () => new URL(input.url), catch: (error) => error })
              if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
                return yield* Effect.fail(new Error("URL must use http:// or https://"))
              if (input.sha256 && !/^[a-fA-F0-9]{64}$/.test(input.sha256))
                return yield* Effect.fail(new Error("sha256 must contain exactly 64 hexadecimal characters"))

              const source = {
                type: "tool" as const,
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              }
              const target = yield* mutation.resolve({ path: input.filePath, kind: "file" })
              if (target.externalDirectory)
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(target.externalDirectory),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              yield* permission.assert({
                action: name,
                resources: [input.url],
                save: ["*"],
                metadata: { url: input.url, filePath: target.resource },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              yield* permission.assert({
                action: "edit",
                resources: [target.resource],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })

              const result = yield* Download.file({
                http,
                fs,
                url: input.url,
                filePath: target.canonical,
                temporaryID: context.toolCallID,
                expectedSha256: input.sha256,
                overwrite: input.overwrite,
                onProgress: (download) =>
                  context.progress?.({
                    structured: {
                      url: input.url,
                      filePath: target.canonical,
                      download,
                    },
                  }) ?? Effect.void,
              })
              return { download: result, sha256: result.sha256 }
            }).pipe(
              Effect.mapError(
                (error) =>
                  new ToolFailure({
                    message: `Download failed: ${error instanceof Error ? error.message : String(error)}`,
                  }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/download",
  layer,
  deps: [ToolRegistry.node, LocationMutation.node, FSUtil.node, PermissionV2.node, LayerNodePlatform.httpClient],
})
