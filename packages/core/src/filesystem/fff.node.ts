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
  logFilePath?: string
  logLevel?: "trace" | "debug" | "info" | "warn" | "error"
  enableFsRootScanning?: boolean
  enableHomeDirScanning?: boolean
}

export interface File {
  relativePath: string
  fileName: string
  modified: number
}

export interface Directory {
  relativePath: string
  dirName: string
  maxAccessFrecency: number
}

export type Mixed = { type: "file"; item: File } | { type: "directory"; item: Directory }

export interface Search {
  items: File[]
  scores: Array<{ total: number }>
  totalMatched: number
  totalFiles: number
}

export interface DirSearch {
  items: Directory[]
  scores: Array<{ total: number }>
  totalMatched: number
  totalDirs: number
}

export interface MixedSearch {
  items: Mixed[]
  scores: Array<{ total: number }>
  totalMatched: number
  totalFiles: number
  totalDirs: number
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
  waitForScan(timeoutMs?: number): Promise<Result<boolean>>
  refreshGitStatus(): Result<number>
  fileSearch(
    query: string,
    opts?: {
      currentFile?: string
      pageIndex?: number
      pageSize?: number
    },
  ): Result<Search>
  glob(
    pattern: string,
    opts?: {
      currentFile?: string
      pageIndex?: number
      pageSize?: number
    },
  ): Result<Search>
  directorySearch(
    query: string,
    opts?: {
      currentFile?: string
      pageIndex?: number
      pageSize?: number
    },
  ): Result<DirSearch>
  mixedSearch(
    query: string,
    opts?: {
      currentFile?: string
      pageIndex?: number
      pageSize?: number
    },
  ): Result<MixedSearch>
  grep(
    query: string,
    opts?: {
      mode?: "plain" | "regex" | "fuzzy"
      maxMatchesPerFile?: number
      timeBudgetMs?: number
      beforeContext?: number
      afterContext?: number
      cursor?: Cursor
      pageSize?: number
    },
  ): Result<Grep>
  trackQuery(query: string, file: string): Result<boolean>
  getHistoricalQuery(offset: number): Result<string | null>
}

export function available() {
  return false
}

export function create(_opts: Init): Result<Picker> {
  return { ok: false, error: "fff unavailable on node runtime" }
}

export * as Fff from "./fff.node"
