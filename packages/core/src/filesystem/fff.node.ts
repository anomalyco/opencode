import type {
  DirItem,
  DirSearchResult,
  FileItem,
  InitOptions,
  MixedItem,
  MixedSearchResult,
  SearchResult,
} from "@ff-labs/fff-node"

const { FileFinder } = await import("@ff-labs/fff-node").catch(() => ({ FileFinder: undefined }))

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
  trackQuery(query: string, file: string): Result<boolean>
  getHistoricalQuery(offset: number): Result<string | null>
}

export function available() {
  return FileFinder?.isAvailable() ?? false
}

export function create(opts: Init): Result<Picker> {
  if (!FileFinder) return { ok: false, error: "fff unavailable on node runtime" }
  const made = FileFinder.create(opts)
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
      directorySearch: (query, next) => pick.directorySearch(query, next),
      mixedSearch: (query, next) => pick.mixedSearch(query, next),
      trackQuery: (query, file) => pick.trackQuery(query, file),
      getHistoricalQuery: (offset) => pick.getHistoricalQuery(offset),
    },
  }
}

export * as Fff from "./fff.node"
