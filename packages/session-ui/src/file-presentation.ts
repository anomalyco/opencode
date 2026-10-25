export type PresentationFileDiff = {
  file?: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export type PresentationFileContent = {
  type: "text" | "binary"
  content: string
  encoding?: "base64"
  mimeType?: string
}

type FilePartSourceText = {
  value: string
  start: number
  end: number
}

export type FilePartSource =
  | { type: "file"; text: FilePartSourceText; path: string }
  | {
      type: "symbol"
      text: FilePartSourceText
      path: string
      range: { start: { line: number; character: number }; end: { line: number; character: number } }
      name: string
      kind: number
    }
  | { type: "resource"; text: FilePartSourceText; clientName: string; uri: string }
