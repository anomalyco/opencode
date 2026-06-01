import type { FileNodeType } from "./file-reference-block"
import type { LineRefInput } from "./line-reference-url"

export const OPEN_LINE_REFERENCE = "opencode-open-line-reference"
export const OPEN_FILE_REFERENCE = "opencode-open-file-reference"

export type OpenLineReferenceDetail = LineRefInput

export type OpenFileReferenceDetail = {
  path: string
  nodeType?: FileNodeType
}
