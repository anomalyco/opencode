import type {
  DirItem,
  DirSearchResult,
  FileItem,
  GrepCursor,
  GrepMatch,
  GrepResult,
  InitOptions,
  MixedItem,
  MixedSearchResult,
  SearchResult,
} from "@ff-labs/fff-node"

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export type Init = InitOptions

export interface Search {
  items: FileItem[]
  scores: SearchResult["scores"]
  totalMatched: number
  totalFiles: number
}

export interface DirSearch {
  items: DirItem[]
  scores: DirSearchResult["scores"]
  totalMatched: number
  totalDirs: number
}

export interface MixedSearch {
  items: MixedItem[]
  scores: MixedSearchResult["scores"]
  totalMatched: number
  totalFiles: number
  totalDirs: number
}

export type File = FileItem
export type Directory = DirItem
export type Mixed = MixedItem
export type Cursor = GrepCursor | null
export type Hit = GrepMatch

export interface Grep {
  items: GrepResult["items"]
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

// workerd cannot load the fff native binding; reporting unavailable makes
// FileSystemSearch fall back to its non-fff layer.
export function available() {
  return false
}

export function create(_opts: Init): Result<Picker> {
  return { ok: false, error: "fff unavailable on workerd runtime" }
}

export * as Fff from "./fff.workerd"
