import type { FileContent } from "@opencode-ai/sdk/v2"

export type FileSelection = {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

export type SelectedLineRange = {
  start: number
  end: number
  side?: "additions" | "deletions"
  endSide?: "additions" | "deletions"
}

export type FileViewState = {
  scrollTop?: number
  scrollLeft?: number
  selectedLines?: SelectedLineRange | null
}

// FORK: 大文件预览统一防护 — L1 入口闸门标记;UI 渲染前判断 tooLarge 走 FileTooLarge 组件 [feat: large-file-preview-guard] 2026-05-21
export type FileTooLargeMark = {
  size: number
  category: string
  limit: number
}

export type FileState = {
  path: string
  name: string
  loaded?: boolean
  loading?: boolean
  error?: string
  content?: FileContent
  // FORK: 大文件预览统一防护 [feat: large-file-preview-guard] 2026-05-21
  tooLarge?: FileTooLargeMark
}

export function selectionFromLines(range: SelectedLineRange): FileSelection {
  const startLine = Math.min(range.start, range.end)
  const endLine = Math.max(range.start, range.end)
  return {
    startLine,
    endLine,
    startChar: 0,
    endChar: 0,
  }
}
