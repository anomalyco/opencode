import { describe, expect, test } from "bun:test"
import { invalidateFromWatcher } from "./watcher"

describe("file watcher invalidation", () => {
  test("reloads open files and refreshes loaded parent on add", () => {
    const loads: string[] = []
    const refresh: string[] = []
    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/new.ts",
          event: "add",
        },
      },
      {
        normalize: (input) => input,
        hasFile: (path) => path === "src/new.ts",
        loadFile: (path) => loads.push(path),
        node: () => undefined,
        isDirLoaded: (path) => path === "src",
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(loads).toEqual(["src/new.ts"])
    expect(refresh).toEqual(["src"])
  })

  test("reloads files that are open in tabs", () => {
    const loads: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/open.ts",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        isOpen: (path) => path === "src/open.ts",
        loadFile: (path) => loads.push(path),
        node: () => ({
          path: "src/open.ts",
          type: "file",
          name: "open.ts",
          absolute: "/repo/src/open.ts",
          ignored: false,
        }),
        isDirLoaded: () => false,
        refreshDir: () => {},
      },
    )

    expect(loads).toEqual(["src/open.ts"])
  })

  test("refreshes only changed loaded directory nodes", () => {
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        loadFile: () => {},
        node: () => ({ path: "src", type: "directory", name: "src", absolute: "/repo/src", ignored: false }),
        isDirLoaded: (path) => path === "src",
        refreshDir: (path) => refresh.push(path),
      },
    )

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/file.ts",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        loadFile: () => {},
        node: () => ({
          path: "src/file.ts",
          type: "file",
          name: "file.ts",
          absolute: "/repo/src/file.ts",
          ignored: false,
        }),
        isDirLoaded: () => true,
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(refresh).toEqual(["src"])
  })

  test("ignores invalid or git watcher updates", () => {
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: ".git/index.lock",
          event: "change",
        },
      },
      {
        normalize: (input) => input,
        hasFile: () => true,
        loadFile: () => {
          throw new Error("should not load")
        },
        node: () => undefined,
        isDirLoaded: () => true,
        refreshDir: (path) => refresh.push(path),
      },
    )

    invalidateFromWatcher(
      {
        type: "project.updated",
        properties: {},
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        loadFile: () => {},
        node: () => undefined,
        isDirLoaded: () => true,
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(refresh).toEqual([])
  })
})

describe("file.edited tool-direct invalidation", () => {
  test("reloads open file when AI tool edits it", () => {
    const loads: string[] = []
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.edited",
        properties: { file: "src/foo.ts" },
      },
      {
        normalize: (input) => input,
        hasFile: (path) => path === "src/foo.ts",
        loadFile: (path) => loads.push(path),
        node: () => undefined,
        isDirLoaded: () => true,
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(loads).toEqual(["src/foo.ts"])
    // file.edited 不刷目录树
    expect(refresh).toEqual([])
  })

  test("reloads file open in tab even if not in cache", () => {
    const loads: string[] = []

    invalidateFromWatcher(
      {
        type: "file.edited",
        properties: { file: "docs/readme.md" },
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        isOpen: (path) => path === "docs/readme.md",
        loadFile: (path) => loads.push(path),
        node: () => undefined,
        isDirLoaded: () => false,
        refreshDir: () => {},
      },
    )

    expect(loads).toEqual(["docs/readme.md"])
  })

  test("skips load when file is dirty (user has unsaved draft) and notifies conflict", () => {
    const loads: string[] = []
    const conflicts: string[] = []

    invalidateFromWatcher(
      {
        type: "file.edited",
        properties: { file: "src/draft.ts" },
      },
      {
        normalize: (input) => input,
        hasFile: () => true,
        isDirty: (path) => path === "src/draft.ts",
        notifyDirtyConflict: (path) => conflicts.push(path),
        loadFile: (path) => loads.push(path),
        node: () => undefined,
        isDirLoaded: () => false,
        refreshDir: () => {},
      },
    )

    expect(loads).toEqual([])
    expect(conflicts).toEqual(["src/draft.ts"])
  })

  test("does not loadFile for files not open or cached, and does not refresh dir when parent not loaded", () => {
    const loads: string[] = []
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.edited",
        properties: { file: "irrelevant/path.ts" },
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        isOpen: () => false,
        loadFile: (path) => loads.push(path),
        node: () => undefined,
        isDirLoaded: () => false,
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(loads).toEqual([])
    expect(refresh).toEqual([])
  })

  // FORK: bug-repro AI 创建新文件后右侧文件树不刷新 2026-05-15
  // 触发路径:user 之前展开过某目录(loaded: true)后折叠(expanded: false 但 loaded 缓存保留)→
  // AI 写入新文件 → file.edited 老路径 hasFile=false + isOpen=false 直接 return → 目录树没刷 →
  // user 重新展开看到旧 children 列表 → 唯一破解是 reset 整个 tree(F5 / app 重启)。
  // 修法:!hasFile && !isOpen 时若 isDirLoaded(parent) → refreshDir(parent),
  // 让新文件浮现到下次展开的列表里。
  test("refreshes parent dir on file.edited when path is new but parent loaded (AI create-file scenario)", () => {
    const loads: string[] = []
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.edited",
        properties: { file: "output/newfile.html" },
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        isOpen: () => false,
        loadFile: (path) => loads.push(path),
        node: () => undefined,
        // 父目录 output 之前展开过(loaded=true),即使现在折叠状态 isDirLoaded 仍 true
        isDirLoaded: (path) => path === "output",
        refreshDir: (path) => refresh.push(path),
      },
    )

    // 文件没在 cache/open,不应 loadFile
    expect(loads).toEqual([])
    // 但父目录已加载,应刷父目录让新文件浮现
    expect(refresh).toEqual(["output"])
  })

  test("file.edited new file at root refreshes root when root loaded", () => {
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.edited",
        properties: { file: "newfile.md" },
      },
      {
        normalize: (input) => input,
        hasFile: () => false,
        isOpen: () => false,
        loadFile: () => {},
        node: () => undefined,
        isDirLoaded: (path) => path === "",
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(refresh).toEqual([""])
  })

  test("ignores file.edited for .git paths", () => {
    const loads: string[] = []

    invalidateFromWatcher(
      {
        type: "file.edited",
        properties: { file: ".git/HEAD" },
      },
      {
        normalize: (input) => input,
        hasFile: () => true,
        loadFile: (path) => loads.push(path),
        node: () => undefined,
        isDirLoaded: () => false,
        refreshDir: () => {},
      },
    )

    expect(loads).toEqual([])
  })

  test("file.watcher.updated also honors isDirty guard (external edit while drafting)", () => {
    const loads: string[] = []
    const conflicts: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: { file: "src/draft.ts", event: "change" },
      },
      {
        normalize: (input) => input,
        hasFile: () => true,
        isDirty: (path) => path === "src/draft.ts",
        notifyDirtyConflict: (path) => conflicts.push(path),
        loadFile: (path) => loads.push(path),
        node: () => ({
          path: "src/draft.ts",
          type: "file",
          name: "draft.ts",
          absolute: "/repo/src/draft.ts",
          ignored: false,
        }),
        isDirLoaded: () => false,
        refreshDir: () => {},
      },
    )

    expect(loads).toEqual([])
    expect(conflicts).toEqual(["src/draft.ts"])
  })
})
