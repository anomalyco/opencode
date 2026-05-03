// FORK-only file: office routes 的 schema 定义集中区
// 设计意图详见 docs/features/office-routes-effect-httpapi/1-spec.md
// 主调入口在 ./file.ts(FORK block)/ ../handlers/file.ts(FORK block)2026-05-03

import { Schema } from "effect"
import { HttpApiSchema } from "effect/unstable/httpapi"

export const OfficePdfQuery = Schema.Struct({
  path: Schema.String,
})

export const OfficePdfBytes = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array({ contentType: "application/pdf" }),
)

export const OfficeInstallProgress = Schema.Struct({
  phase: Schema.Literals(["idle", "probing", "downloading", "installing", "done", "error"]),
  bytesDownloaded: Schema.optional(Schema.Number),
  bytesTotal: Schema.optional(Schema.Number),
  percent: Schema.optional(Schema.Number),
  speedBps: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
  mirrorName: Schema.optional(Schema.String),
}).annotate({ identifier: "OfficeInstallProgress" })

export const OfficeToolingStatus = Schema.Struct({
  installed: Schema.Boolean,
  sofficePath: Schema.optional(Schema.String),
  platformSupported: Schema.Boolean,
  downloadSizeMB: Schema.optional(Schema.Number),
  selectedMirror: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      url: Schema.String,
    }),
  ),
  progress: OfficeInstallProgress,
}).annotate({ identifier: "OfficeToolingStatus" })
