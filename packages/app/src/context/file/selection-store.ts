// [fork-only] 文件树多选状态(commit #2 of file-tree-dnd)
//
// 选中的是 absolute path,与 dataTransfer 协议、cycle 检测、move 操作统一。
// 不持久化(刷新即丢),与编辑器/IDE 行为一致。
// rangeSelect 需要外部传入扁平化的 path 顺序(因为树形结构需要遍历各级才能算"区间"),
// 由调用方(file-tree.tsx)负责把当前可见的扁平 path 列表传进来。

import { createSignal } from "solid-js"

export function createSelectionStore() {
  const [paths, setPaths] = createSignal<readonly string[]>([])
  let anchor: string | null = null // shift-click 起点

  const add = (path: string) => {
    if (paths().includes(path)) return
    setPaths([...paths(), path])
  }

  const remove = (path: string) => {
    setPaths(paths().filter((p) => p !== path))
  }

  const toggle = (path: string) => {
    if (paths().includes(path)) remove(path)
    else add(path)
  }

  const clear = () => {
    setPaths([])
    anchor = null
  }

  const isSelected = (path: string) => paths().includes(path)

  const setAnchor = (path: string) => {
    anchor = path
  }

  /**
   * Shift-click 范围选:从 anchor 到 target 的所有可见行。
   * flatVisible 是当前文件树扁平化后的 absolute path 列表(按上下顺序),由调用方传。
   * 找不到 anchor → 退化为 set([target])。
   */
  const rangeSelect = (target: string, flatVisible: readonly string[]) => {
    if (!anchor) {
      setPaths([target])
      anchor = target
      return
    }
    const a = flatVisible.indexOf(anchor)
    const b = flatVisible.indexOf(target)
    if (a < 0 || b < 0) {
      setPaths([target])
      anchor = target
      return
    }
    const [lo, hi] = a < b ? [a, b] : [b, a]
    setPaths(flatVisible.slice(lo, hi + 1))
  }

  /** 纯替换为单选(普通 click 用) */
  const replace = (path: string) => {
    setPaths([path])
    anchor = path
  }

  return {
    paths,
    add,
    remove,
    toggle,
    clear,
    isSelected,
    setAnchor,
    rangeSelect,
    replace,
  }
}

export type SelectionStore = ReturnType<typeof createSelectionStore>
