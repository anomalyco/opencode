import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { invalidateFromWatcher } from "./watcher"

type FilesystemEvent = Extract<OpenCodeEvent, { type: "filesystem.changed" }>

const filesystemEvent = (file: string, event: FilesystemEvent["data"]["event"]): FilesystemEvent => ({
  id: `evt_${file}`,
  created: 1,
  type: "filesystem.changed",
  data: { file, event },
})

describe("file watcher invalidation", () => {
  test("refreshes the loaded workspace root when its entries change", () => {
    const refresh: string[] = []
    invalidateFromWatcher(filesystemEvent("/repo", "change"), {
      normalize: () => "",
      hasFile: () => false,
      loadFile: () => {},
      isDirLoaded: (path) => path === "",
      refreshDir: (path) => refresh.push(path),
    })

    expect(refresh).toEqual([""])
  })

  test("reloads open files and refreshes loaded parent on add", () => {
    const loads: string[] = []
    const refresh: string[] = []
    invalidateFromWatcher(filesystemEvent("src/new.ts", "add"), {
      normalize: (input) => input,
      hasFile: (path) => path === "src/new.ts",
      loadFile: (path) => loads.push(path),
      isDirLoaded: (path) => path === "src",
      refreshDir: (path) => refresh.push(path),
    })

    expect(loads).toEqual(["src/new.ts"])
    expect(refresh).toEqual(["src"])
  })

  test("reloads files that are open in tabs", () => {
    const loads: string[] = []

    invalidateFromWatcher(filesystemEvent("src/open.ts", "change"), {
      normalize: (input) => input,
      hasFile: () => false,
      isOpen: (path) => path === "src/open.ts",
      loadFile: (path) => loads.push(path),
      isDirLoaded: () => false,
      refreshDir: () => {},
    })

    expect(loads).toEqual(["src/open.ts"])
  })

  test.each(["src", "src\\sub"])("refreshes the loaded directory %p without a node-key lookup", (directory) => {
    const refresh: string[] = []

    invalidateFromWatcher(filesystemEvent(directory, "change"), {
      normalize: (input) => input,
      hasFile: () => false,
      loadFile: () => {},
      isDirLoaded: (path) => path === directory,
      refreshDir: (path) => refresh.push(path),
    })

    invalidateFromWatcher(filesystemEvent("src/file.ts", "change"), {
      normalize: (input) => input,
      hasFile: () => false,
      loadFile: () => {},
      isDirLoaded: (path) => path === directory,
      refreshDir: (path) => refresh.push(path),
    })

    expect(refresh).toEqual([directory])
  })

  test("refreshes the parent of a Windows path", () => {
    const refresh: string[] = []

    invalidateFromWatcher(filesystemEvent("src\\sub\\new.ts", "add"), {
      normalize: (input) => input,
      hasFile: () => false,
      loadFile: () => {},
      isDirLoaded: (path) => path === "src/sub",
      refreshDir: (path) => refresh.push(path),
    })

    expect(refresh).toEqual(["src/sub"])
  })

  test.each([".git/index.lock", ".git\\index.lock"])("ignores git watcher update %p", (file) => {
    const refresh: string[] = []

    invalidateFromWatcher(filesystemEvent(file, "change"), {
      normalize: (input) => input,
      hasFile: () => true,
      loadFile: () => {
        throw new Error("should not load")
      },
      isDirLoaded: () => true,
      refreshDir: (path) => refresh.push(path),
    })

    expect(refresh).toEqual([])
  })
})
