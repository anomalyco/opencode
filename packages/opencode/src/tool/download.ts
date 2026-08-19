import path from "node:path"
import { Download } from "@opencode-ai/core/download"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"
import DESCRIPTION from "./download.txt"

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "HTTP or HTTPS URL of the file to download" }),
  filePath: Schema.String.annotate({
    description: "Destination path. Relative paths resolve from the current project directory.",
  }),
  sha256: Schema.String.pipe(Schema.optional).annotate({
    description: "Optional expected SHA-256 checksum (64 hexadecimal characters)",
  }),
  overwrite: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Replace an existing destination file. Defaults to false.",
  }),
})

export const DownloadTool = Tool.define(
  "download",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const fs = yield* FSUtil.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (input: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.try({ try: () => new URL(input.url), catch: (error) => error })
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
            return yield* Effect.fail(new Error("URL must use http:// or https://"))
          if (input.sha256 && !/^[a-fA-F0-9]{64}$/.test(input.sha256))
            return yield* Effect.fail(new Error("sha256 must contain exactly 64 hexadecimal characters"))

          const instance = yield* InstanceState.context
          const filePath = path.isAbsolute(input.filePath)
            ? input.filePath
            : path.resolve(instance.directory, input.filePath)
          yield* assertExternalDirectoryEffect(ctx, filePath)
          yield* ctx.ask({
            permission: "download",
            patterns: [input.url],
            always: ["*"],
            metadata: { url: input.url, filePath },
          })
          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(instance.worktree, filePath)],
            always: ["*"],
            metadata: { filePath },
          })

          const result = yield* Download.file({
            http,
            fs,
            url: input.url,
            filePath,
            temporaryID: ctx.callID ?? `${ctx.messageID}-download`,
            expectedSha256: input.sha256,
            overwrite: input.overwrite,
            onProgress: (download) =>
              ctx.metadata({
                title: path.relative(instance.worktree, filePath),
                metadata: { url: input.url, filePath, download },
              }),
          })

          return {
            title: path.relative(instance.worktree, filePath),
            metadata: {
              url: input.url,
              filePath,
              download: result,
              sha256: result.sha256,
            },
            output: `Downloaded ${result.receivedBytes} bytes to ${filePath}. SHA-256: ${result.sha256}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
