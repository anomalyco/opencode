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
} from "@ff-labs/fff-bun"

declare global {
  const FFF_LIBC: "gnu" | "musl"
}

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

// @ff-labs/fff-bun is not published for every platform (e.g. FreeBSD), so
// degrade to unavailable when the module is missing
const binding = await import("@ff-labs/fff-bun").catch(() => undefined)

export function available() {
  return binding?.FileFinder.isAvailable() ?? false
}

export function create(opts: Init): Result<Picker> {
  if (!binding) return { ok: false, error: "fff unavailable: @ff-labs/fff-bun is not installed" }
  const made = binding.FileFinder.create(opts)
  if (!made.ok) return made
  const pick = made.value
  return {
    ok: true,
    value: {
      destroy: () => pick.destroy(),
      isScanning: () => pick.isScanning(),
      waitForScan: (timeoutMs) => pick.waitForScan(timeoutMs),
      refreshGitStatus: () => pick.refreshGitStatus(),
      fileSearch: (query, next) => pick.fileSearch(query, next),
      glob: (pattern, next) => pick.glob(pattern, next),
      directorySearch: (query, next) => pick.directorySearch(query, next),
      mixedSearch: (query, next) => pick.mixedSearch(query, next),
      grep: (query, next) => pick.grep(query, next),
      trackQuery: (query, file) => pick.trackQuery(query, file),
      getHistoricalQuery: (offset) => pick.getHistoricalQuery(offset),
    },
  }
}

export * as Fff from "./fff.bun"
