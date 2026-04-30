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

  test("ignores file.edited for files not open or cached", () => {
    const loads: string[] = []

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
        refreshDir: () => {},
      },
    )

    expect(loads).toEqual([])
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
