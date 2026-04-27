// [fork-only] 文件树剪切/复制板(commit #3 of file-tree-dnd)
//
// 协议:
// - mode === "cut" → paste 时调 rename_path(等价 move),清空 clipboard
// - mode === "copy" → paste 时调 copy_path,**保留** clipboard(允许多次粘贴到不同位置)
// - 不持久化(刷新即丢)

import { createSignal } from "solid-js"

type ClipboardMode = "cut" | "copy"

export function createClipboardStore() {
  const [mode, setMode] = createSignal<ClipboardMode | null>(null)
  const [paths, setPaths] = createSignal<readonly string[]>([])

  const setCut = (next: readonly string[]) => {
    if (next.length === 0) {
      clear()
      return
    }
    setMode("cut")
    setPaths(next)
  }

  const setCopy = (next: readonly string[]) => {
    if (next.length === 0) {
      clear()
      return
    }
    setMode("copy")
    setPaths(next)
  }

  const clear = () => {
    setMode(null)
    setPaths([])
  }

  /** 当前 path 是否处于 cut 状态(用于行视觉) */
  const isCut = (path: string) => mode() === "cut" && paths().includes(path)

  /** clipboard 是否非空(用于决定粘贴菜单 enabled) */
  const hasContent = () => mode() !== null && paths().length > 0

  return {
    mode,
    paths,
    setCut,
    setCopy,
    clear,
    isCut,
    hasContent,
  }
}

export type ClipboardStore = ReturnType<typeof createClipboardStore>
