// FORK: Phase 1 e2e mock — 内存文件系统
// [feat: e2e-phase1-mock-mode] 2026-05-23 W1 D4
//
// 模拟磁盘行为 + sidecar watcher event,被 e2e/mocks/tauri.ts 的 invoke handler 共享。
// 设计原则:
//   - **行为对齐真后端**:mtime 自增、size 算 utf8 byte length(参 e2e/mocks/MANIFEST.md §四)
//   - **测试隔离**:每个 Playwright test 跑前 `memfs.reset()`,无状态泄漏
//   - **0 依赖**:纯 in-memory Map,不碰真磁盘 / 不依赖 fs / 不依赖任何 mock 库
//
// 用法(在 e2e spec 内):
// ```ts
// import { memfs } from "./mocks/memfs"
// memfs.reset()
// memfs.preload({ "notes.md": "old content" })
// // 触发 UI 操作,后端走 mock tauri.ts → memfs.write(...)
// expect(memfs.read("notes.md")?.content).toContain("new content")
// ```

export type FileContent = string | Uint8Array

export interface FileEntry {
  content: FileContent
  mtime: number
  size: number
}

export interface DirListItem {
  name: string
  isDir: boolean
  size: number
  mtime: number
}

export type WatcherEventType = "file.edited" | "file.watcher.updated"

export interface WatcherEvent {
  type: WatcherEventType
  path: string
  oldMtime?: number
  newMtime?: number
  /** "self" = mock 自己写的(对齐真 sidecar 的 markSelfWriting 行为)/ "external" = 模拟外部改动 */
  source?: "self" | "external"
}

// utf8 byte length(简化,Node Buffer 不可用就用 TextEncoder)
function utf8Size(s: string): number {
  // happydom + chromium 都有 TextEncoder
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length
}

function contentSize(c: FileContent): number {
  return typeof c === "string" ? utf8Size(c) : c.byteLength
}

class MemFS {
  private files = new Map<string, FileEntry>()
  private listeners = new Map<WatcherEventType, Set<(e: WatcherEvent) => void>>()
  /** mtime 单调递增,起步从当前时间,保证不冲突 */
  private mtimeCounter = Date.now()

  private nextMtime(): number {
    // 严格递增 — 同毫秒两次 write 也要后者 mtime 大(对齐真 sidecar 不会撞)
    this.mtimeCounter = Math.max(this.mtimeCounter + 1, Date.now())
    return this.mtimeCounter
  }

  // ============== 读写 ==============

  read(path: string): FileEntry | null {
    const f = this.files.get(path)
    return f ? { ...f } : null
  }

  write(path: string, content: FileContent, source: "self" | "external" = "self"): number {
    const old = this.files.get(path)
    const mtime = this.nextMtime()
    this.files.set(path, { content, mtime, size: contentSize(content) })
    this.emit({
      type: "file.edited",
      path,
      oldMtime: old?.mtime,
      newMtime: mtime,
      source,
    })
    return mtime
  }

  delete(path: string): boolean {
    const had = this.files.delete(path)
    if (had) {
      this.emit({ type: "file.watcher.updated", path })
    }
    return had
  }

  exists(path: string): boolean {
    return this.files.has(path)
  }

  list(dir: string): DirListItem[] {
    // FORK: 空 dir = root listing(prefix 必须空字符串,否则 "/"+"small.txt".startsWith("/") 始终 false,所有 root 文件被跳过)
    // 2026-05-23 bug-repro-3case A6 spec 实测撞 → 修;非空 dir 走原拼 "/" 行为
    const prefix = dir === "" ? "" : dir.endsWith("/") ? dir : dir + "/"
    const items: DirListItem[] = []
    const seenDirs = new Set<string>()
    for (const [p, entry] of this.files) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      if (!rest) continue
      const slash = rest.indexOf("/")
      if (slash === -1) {
        items.push({ name: rest, isDir: false, size: entry.size, mtime: entry.mtime })
      } else {
        const dirName = rest.slice(0, slash)
        if (!seenDirs.has(dirName)) {
          seenDirs.add(dirName)
          items.push({ name: dirName, isDir: true, size: 0, mtime: entry.mtime })
        }
      }
    }
    return items
  }

  // ============== 元数据 ==============

  getMtime(path: string): number | null {
    return this.files.get(path)?.mtime ?? null
  }

  getSize(path: string): number | null {
    return this.files.get(path)?.size ?? null
  }

  // ============== watcher ==============

  on(event: WatcherEventType, handler: (e: WatcherEvent) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
    }
  }

  emit(event: WatcherEvent): void {
    const set = this.listeners.get(event.type)
    if (!set) return
    for (const h of set) {
      try {
        h(event)
      } catch (e) {
        console.error("[memfs] listener error", e)
      }
    }
  }

  // ============== 测试辅助 ==============

  reset(): void {
    this.files.clear()
    this.listeners.clear()
    this.mtimeCounter = Date.now()
  }

  preload(files: Record<string, string | Uint8Array>): void {
    for (const [path, content] of Object.entries(files)) {
      const mtime = this.nextMtime()
      this.files.set(path, { content, mtime, size: contentSize(content) })
    }
  }

  /** 测试断言用:返完整 file map 快照 */
  snapshot(): Record<string, FileEntry> {
    return Object.fromEntries(this.files)
  }
}

/** 全局单例 — Playwright spec 通过 `import { memfs } from ...` 共享同一份状态 */
export const memfs = new MemFS()
