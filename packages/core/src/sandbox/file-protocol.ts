export * as SandboxFileProtocol from "./file-protocol.js"

import path from "node:path"
import { Schema } from "effect"
import { EnvironmentFiles } from "../environment/files.js"

export const MAX_DATA_BYTES = 64 * 1024 * 1024
export const MAX_FRAME_BYTES = Math.ceil(MAX_DATA_BYTES / 3) * 4 + 64 * 1024
export const MAX_ENTRIES = 100_000

const Path = Schema.String.check(
  Schema.isMaxLength(32_768),
  Schema.makeFilter((value) => path.isAbsolute(value) && !value.includes("\0")),
)
const Offset = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
const Length = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_DATA_BYTES }))
const Data = Schema.String.check(Schema.isMaxLength(Math.ceil(MAX_DATA_BYTES / 3) * 4))
const Info = Schema.Struct({ type: EnvironmentFiles.FileType, size: Schema.Finite, mtimeMs: Schema.Finite })

export const Request = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("read"),
    path: Path,
    range: Schema.optional(Schema.Struct({ offset: Offset, length: Length })),
  }).check(
    Schema.makeFilter((request) => !request.range || Number.isSafeInteger(request.range.offset + request.range.length)),
  ),
  Schema.Struct({ op: Schema.Literal("write"), path: Path, data: Data }),
  Schema.Struct({ op: Schema.Literal("check"), path: Path, operation: Schema.Literals(["write", "remove"]) }),
  Schema.Struct({ op: Schema.Literals(["stat", "list", "mkdir", "remove"]), path: Path }),
  Schema.Struct({ op: Schema.Literal("move"), path: Path, to: Path }),
])
export type Request = typeof Request.Type

export const Reply = Schema.Union([
  Schema.Struct({ op: Schema.Literal("read"), info: Info, data: Data }),
  Schema.Struct({ op: Schema.Literal("stat"), info: Info }),
  Schema.Struct({
    op: Schema.Literal("list"),
    entries: Schema.Array(Schema.Struct({ name: Schema.String, type: EnvironmentFiles.FileType })).check(
      Schema.isMaxLength(MAX_ENTRIES),
    ),
  }),
  Schema.Struct({ op: Schema.Literals(["write", "mkdir", "remove", "move", "check"]) }),
  Schema.Struct({
    op: Schema.Literal("error"),
    kind: Schema.Literals(["NotFound", "WrongKind", "Failed"]),
    actual: Schema.optional(EnvironmentFiles.FileType),
    message: Schema.String,
  }),
])
export type Reply = typeof Reply.Type
