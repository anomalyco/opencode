// [fork-only] 文件树键盘快捷键(commit #3 of file-tree-dnd)
//
// 触发条件(OR):
//   A. activeElement 在 [data-component=filetree] 内(用户刚点过文件树)
//   B. 文件树 selection 非空 + activeElement 不是可编辑控件 + 浏览器文本选区为空(或落在文件树内)
//      ←  v1 用户单击文件后焦点常跑到 main editor,但文件树 selection 还在,这时 Ctrl+C/V 期望仍生效
//      ←  浏览器文本选区在文件树外(聊天区 / 只读 viewer)时,意图是复制文本,B 让位给原生
//
// 这避免抢占编辑器 / 输入框 / 终端的 Ctrl+X/C/V/Z(它们的 activeElement 是可编辑控件,B 不满足)
// 也避免抢占聊天气泡 / 文档查看器的 Ctrl+C(那些是普通 div,activeElement 是 body,靠"文本选区在外"兜底)
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

/**
 * 浏览器文本选区是否非空且落在文件树之外。
 * 聊天区 / 只读文档查看器是普通 div,activeElement 多为 body —— 单凭 activeIsEditable 防不住。
 * 用户在这些区域选了文本按 Ctrl+C,意图就是复制文本,B 路径不能抢。
 */
function hasTextSelectionOutsideFileTree(): boolean {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return false
  if (sel.toString().length === 0) return false
  const node = sel.anchorNode
  const el = node instanceof Element ? node : (node?.parentElement ?? null)
  if (!el) return false
  return !el.closest('[data-component="filetree"]')
}

export function useFileTreeShortcuts(handlers: ShortcutHandlers) {
  const shouldTrigger = (): boolean => {
    if (activeInFileTree()) return true // A:focus 在文件树
    if (activeIsEditable()) return false // 可编辑控件优先,即便 selection 非空也不抢
    // 中性区(body 等)有文本选区 → 用户要复制文本,让原生 Ctrl+C/X/V 走
    if (hasTextSelectionOutsideFileTree()) return false
    return Boolean(handlers.hasSelection?.()) // B:focus 在中性区 + 文件树 selection 非空
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
