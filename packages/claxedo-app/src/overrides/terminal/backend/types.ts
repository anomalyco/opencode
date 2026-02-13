export interface Disposable {
  dispose(): void
}

export interface TerminalBackendOptions {
  theme: TerminalColors
  fontFamily: string
  onSplitVertical?: () => void
  onSplitHorizontal?: () => void
  onFileLinkClick?: (path: string, line?: number, col?: number) => void
  onUrlClick?: (event: MouseEvent, url: string) => void
}

export type TerminalColors = {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

export interface TerminalBackend {
  // Dimensions
  readonly cols: number
  readonly rows: number

  // DOM refs (for focus/blur event wiring)
  readonly textarea: HTMLTextAreaElement | null
  readonly element: HTMLElement | null

  // I/O
  write(data: string, callback?: () => void): void
  onData(fn: (data: string) => void): Disposable
  onKey(fn: (e: { key: string }) => void): Disposable
  onResize(fn: (size: { cols: number; rows: number }) => void): Disposable

  // Options (reactive updates from SolidJS effects)
  setTheme(theme: TerminalColors): void
  setFontFamily(font: string): void
  setCursorBlink(blink: boolean): void

  // Focus
  focus(): void

  // Selection
  getSelection(): string
  hasSelection(): boolean

  // Scroll & viewport
  scrollToLine(line: number): void
  scrollToBottom(): void
  getViewportY(): number
  isAtBottom(): boolean

  // Resize
  resize(cols: number, rows: number): void
  fit(): void
  refresh(start: number, end: number): void
  flushResize(): void

  // Serialization
  serialize(options?: {
    scrollback?: number
    excludeModes?: boolean
    excludeAltBuffer?: boolean
  }): string

  /** Escape sequences to restore non-default terminal modes (DECSET/DECRST) in a fresh instance. */
  rehydrateSequences(): string

  /** Whether the terminal is currently in alternate screen mode (mode 1049). */
  isAltScreen(): boolean

  // Lifecycle
  dispose(): void
}

export type CreateBackendFn = (
  container: HTMLDivElement,
  options: TerminalBackendOptions,
) => Promise<TerminalBackend>
