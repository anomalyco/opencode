// [fork-only] 文件树键盘快捷键(commit #3 of file-tree-dnd)
//
// 触发条件(OR):
//   A. activeElement 在 [data-component=filetree] 内(用户刚点过文件树)
//   B. selection 非空 + activeElement 不是可编辑控件(input/textarea/contenteditable)
//      ←  v1 用户单击文件后焦点常跑到 main editor,但 selection 还在,这时 Ctrl+C/V 期望仍生效
//
// 这避免抢占编辑器 / 输入框 / 终端的 Ctrl+X/C/V/Z(它们的 activeElement 是可编辑控件,B 不满足)
//
// 支持:
// - Ctrl+X (Cut)  剪切当前 selection
// - Ctrl+C (Copy) 复制当前 selection
// - Ctrl+V (Paste) 粘贴到当前 active 文件夹(如果 active 是文件,粘贴到其父目录)
// - Ctrl+Z (Undo) commit #4 接入

import { onCleanup, onMount } from "solid-js"

export type ShortcutHandlers = {
  onCut?: () => void | Promise<void>
  onCopy?: () => void | Promise<void>
  onPaste?: () => void | Promise<void>
  onUndo?: () => void | Promise<void>
  /** 当前 selection 是否非空 — 用于 B 路径判定 */
  hasSelection?: () => boolean
}

/** activeElement 是否在文件树内 */
function activeInFileTree(): boolean {
  const el = document.activeElement
  if (!(el instanceof Element)) return false
  return Boolean(el.closest('[data-component="filetree"]'))
}

/** activeElement 是否是可编辑控件(避免抢编辑器/输入框 Ctrl+X/C/V) */
function activeIsEditable(): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

export function useFileTreeShortcuts(handlers: ShortcutHandlers) {
  const shouldTrigger = (): boolean => {
    if (activeInFileTree()) return true // A:focus 在文件树
    if (activeIsEditable()) return false // 可编辑控件优先,即便 selection 非空也不抢
    return Boolean(handlers.hasSelection?.()) // B:focus 在中性区(body 等)+ selection 非空
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!shouldTrigger()) return
    const meta = event.ctrlKey || event.metaKey
    if (!meta) return
    // 跳过 shift / alt 组合,留给浏览器/系统
    if (event.shiftKey || event.altKey) return

    switch (event.key.toLowerCase()) {
      case "x":
        if (handlers.onCut) {
          event.preventDefault()
          void handlers.onCut()
        }
        return
      case "c":
        if (handlers.onCopy) {
          event.preventDefault()
          void handlers.onCopy()
        }
        return
      case "v":
        if (handlers.onPaste) {
          event.preventDefault()
          void handlers.onPaste()
        }
        return
      case "z":
        if (handlers.onUndo) {
          event.preventDefault()
          void handlers.onUndo()
        }
        return
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onKeyDown)
  })
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown)
  })
}
