export interface LineRange {
  start: number
  end: number
  side?: "additions" | "deletions"
  endSide?: "additions" | "deletions"
}
export interface TextSelection {
  startLine: number
  endLine: number
  startChar: number
  endChar: number
}
export interface FileNode {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}
export interface FileState {
  path: string
  name: string
  loaded?: boolean
  loading?: boolean
  error?: string
  content?: { type: "text" | "binary"; content: string; encoding?: "base64"; mimeType?: string }
}
export interface Files {
  readonly directory: string
  ready(): boolean
  normalize(path: string): string
  tab(path: string): string
  pathFromTab(tab: string): string | undefined
  get(path: string): FileState | undefined
  load(path: string, options?: { force?: boolean }): Promise<void>
  selectedLines(path: string): LineRange | null | undefined
  setSelectedLines(path: string, range: LineRange | null): unknown
  scrollTop(path: string): number | undefined
  scrollLeft(path: string): number | undefined
  setScrollTop(path: string, top: number): unknown
  setScrollLeft(path: string, left: number): unknown
  searchFiles(query: string, options?: { limit?: number; signal?: AbortSignal }): Promise<string[]>
  searchFilesAndDirectories(query: string): Promise<string[]>
  readonly tree: {
    list(path: string): Promise<void>
    refresh(path: string): Promise<void>
    state(path: string): { expanded: boolean; loaded?: boolean; loading?: boolean; error?: string } | undefined
    children(path: string): FileNode[]
    expand(path: string, options?: { list?: boolean }): unknown
    collapse(path: string): unknown
  }
}

export interface Annotation {
  id: string
  time: number
  file: string
  selection: LineRange
  comment: string
}
export interface Annotations {
  all(): Annotation[]
  list(file: string): Annotation[]
  add(input: Omit<Annotation, "id" | "time">): Annotation
  update(file: string, id: string, comment: string): void
  remove(file: string, id: string): void
  focus(): { file: string; id: string } | null
  setFocus(value: { file: string; id: string } | null): unknown
  clearFocus(): void
}
export interface DraftFile {
  type: "file"
  path: string
  selection?: TextSelection
  preview?: string
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
}
export interface Draft {
  readonly context: {
    add(input: DraftFile): unknown
    updateComment(path: string, id: string, input: { comment?: string; preview?: string }): unknown
    removeComment(path: string, id: string): unknown
  }
}

export interface SessionView {
  ready(): boolean
  desktop(): boolean
  readonly tabs: {
    all(): string[]
    active(): string | undefined
    open(reference: string): Promise<void>
    setActive(reference: string): void
    close(reference: string): void
    canClose(reference: string): boolean
    preview(): string | undefined
    previewTab(reference: string): void
  }
  readonly panel: {
    opened(): boolean
    open(source?: string): void
    close(): void
    toggle(): void
    source(): string
  }
  readonly sidebar: {
    allowed(): boolean
    opened(): boolean
    width(): number
    resize(width: number): void
    toggle(): void
    tab(): string
    setTab(value: "changes" | "all"): void
  }
  scroll(key: string): { x: number; y: number } | undefined
  setScroll(key: string, value: { x: number; y: number }): void
}

/** Shared workspace/draft capabilities. Feature queries and presentation remain extension-owned. */
export interface SessionServices {
  /** Shared diff presentation preference, also used by built-in session surfaces. */
  readonly display: { wrapDiff(): boolean }
  readonly files: Files
  readonly annotations: Annotations
  readonly draft: Draft
  readonly view: SessionView
  readonly project: { id: string; directory: string; name?: string; vcs?: string } | undefined
}

export function selectionFromLines(range: LineRange): TextSelection {
  return {
    startLine: Math.min(range.start, range.end),
    endLine: Math.max(range.start, range.end),
    startChar: 0,
    endChar: 0,
  }
}
