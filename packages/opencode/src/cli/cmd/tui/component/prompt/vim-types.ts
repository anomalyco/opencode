export type VimMode = "insert" | "normal"

export type VimOperator = "delete" | "change"

export type VimFindType = "f" | "F" | "t" | "T"

export type VimPendingOperator = {
  op: VimOperator
  textObjectScope?: "inner" | "around"
  find?: VimFindType
}

export type VimPendingFind = {
  find: VimFindType
}

export type VimLastFind = {
  find: VimFindType
  char: string
}

export type PromptKeyEvent = {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  preventDefault(): void
}

export type VimRuntime = {
  readonly text: string
  readonly cursor: number
  readonly enabled: boolean
  readonly mode: VimMode
  readonly pendingG: boolean
  readonly pendingOperator: VimPendingOperator | undefined
  readonly pendingFind: VimPendingFind | undefined
  readonly lastFind: VimLastFind | undefined
  setMode(mode: VimMode): void
  setPendingG(value: boolean): void
  setPendingOperator(value: VimPendingOperator | undefined): void
  setPendingFind(value: VimPendingFind | undefined): void
  setLastFind(value: VimLastFind | undefined): void
  moveCursor(offset: number): void
  replaceText(text: string): void
  syncPromptInput(): void
  writeMarker(phase: string): void
}
