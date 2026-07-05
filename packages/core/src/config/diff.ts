export * as ConfigDiff from "./diff"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Info extends Schema.Class<Info>("ConfigV2.Diff")({
  max_files: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum number of files to render in diff viewers (default: 1000)",
  }),
  max_patch_bytes: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum size in bytes for a single file patch (default: 102400 = 100KB)",
  }),
}) {}

export const DEFAULT_MAX_FILES = 1000
export const DEFAULT_MAX_PATCH_BYTES = 102400 // 100KB
