export * as File from "./file"

import { Revert } from "@leak-code/schema/revert"

export const Diff = Revert.FileDiff
export type Diff = typeof Diff.Type
