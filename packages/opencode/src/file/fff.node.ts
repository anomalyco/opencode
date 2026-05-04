export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface Init {
  basePath: string
  frecencyDbPath?: string
  historyDbPath?: string
  useUnsafeNoLock?: boolean
  disableMmapCache?: boolean
  disableContentIndexing?: boolean
  disableWatch?: boolean
  aiMode?: boolean
}

export interface File {
  relativePath: string
  fileName: string
  modified: number
}

export interface Search {
  items: File[]
  scores: unknown[]
  totalMatched: number
  totalFiles: number
}

export type Cursor = null

export interface Hit {
  relativePath: string
  fileName: string
  lineNumber: number
  byteOffset: number
  lineContent: string
  matchRanges: [number, number][]
  contextBefore?: string[]
  contextAfter?: string[]
}

export interface Grep {
  items: Hit[]
  totalMatched: number
  totalFilesSearched: number
  totalFiles: number
  filteredFileCount: number
  nextCursor: Cursor
  regexFallbackError?: string
}

export interface Picker {
  destroy(): void
  isScanning(): boolean
  waitForScan(timeout?: number): Result<boolean>
  refreshGitStatus(): Result<number>
  fileSearch(
    query: string,
    opts?: {
      currentFile?: string
      pageIndex?: number
      pageSize?: number
    },
  ): Result<Search>
  grep(
    query: string,
    opts?: {
      mode?: "plain" | "regex" | "fuzzy"
      maxMatchesPerFile?: number
      timeBudgetMs?: number
      beforeContext?: number
      afterContext?: number
      cursor?: Cursor
    },
  ): Result<Grep>
  trackQuery(query: string, file: string): Result<boolean>
  getHistoricalQuery(offset: number): Result<string | null>
}

export function available() {
  return false
}

export function create(_opts: Init): Result<Picker> {
  return { ok: false, error: "fff unavailable" }
}

export * as Fff from "./fff.node"
