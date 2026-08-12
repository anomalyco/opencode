export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface Init {
  basePath: string
  aiMode?: boolean
  disableMmapCache?: boolean
  disableContentIndexing?: boolean
}

export interface SearchOptions {
  currentFile?: string
  pageIndex?: number
  pageSize?: number
}

export interface File {
  relativePath: string
}

export interface Directory {
  relativePath: string
}

export type Mixed = { type: "file"; item: File } | { type: "directory"; item: Directory }

export interface Score {
  total: number
}

export interface Search {
  items: File[]
  scores: Score[]
}

export interface DirSearch {
  items: Directory[]
  scores: Score[]
}

export interface MixedSearch {
  items: Mixed[]
  scores: Score[]
}

export interface Picker {
  destroy(): void
  fileSearch(query: string, options?: SearchOptions): Result<Search>
  directorySearch(query: string, options?: SearchOptions): Result<DirSearch>
  mixedSearch(query: string, options?: SearchOptions): Result<MixedSearch>
}

export interface Backend {
  isAvailable(): boolean
  create(options: Init): Result<Picker>
}

export function bind(backend: Backend | undefined, unavailable = "fff unavailable") {
  return {
    available: () => backend?.isAvailable() ?? false,
    create: (options: Init): Result<Picker> =>
      backend?.create(options) ?? {
        ok: false,
        error: unavailable,
      },
  }
}
