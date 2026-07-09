export * as File from "./file"

import { FileDiff } from "@opencode-ai/schema/file-diff"

export const Diff = FileDiff.Info
export type Diff = typeof Diff.Type
