import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { invalidateFromWatcher } from "./watcher"

type FilesystemEvent = Extract<OpenCodeEvent, { type: "filesystem.changed" }>

const filesystemEvent = (file: string, event: FilesystemEvent["data"]["event"]): FilesystemEvent => ({
  id: `evt_${file}`,
  created: 1,
  type: "filesystem.changed",
  data: { file, event },
})

describe("file watcher invalidation", () => {
  test("reloads open files and refreshes loaded parent on add", () => {
    const loads: string[] = []
    const refresh: string[] = []
    invalidateFromWatcher(filesystemEvent("src/new.ts", "add"), {
      normalize: (input) => input,
      hasFile: (path) => path === "src/new.ts",
      loadFile: (path) => loads.push(path),
      node: () => undefined,
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
      node: () => ({
        path: "src/open.ts",
        type: "file",
        name: "open.ts",
        absolute: "/repo/src/open.ts",
        ignored: false,
      }),
      isDirLoaded: () => false,
      refreshDir: () => {},
    })

    expect(loads).toEqual(["src/open.ts"])
  })

  test("refreshes only changed loaded directory nodes", () => {
    const refresh: string[] = []

    invalidateFromWatcher(filesystemEvent("src", "change"), {
      normalize: (input) => input,
      hasFile: () => false,
      loadFile: () => {},
      node: () => ({ path: "src", type: "directory", name: "src", absolute: "/repo/src", ignored: false }),
      isDirLoaded: (path) => path === "src",
      refreshDir: (path) => refresh.push(path),
    })

    invalidateFromWatcher(filesystemEvent("src/file.ts", "change"), {
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
    })

    expect(refresh).toEqual(["src"])
  })

  test("ignores invalid or git watcher updates", () => {
    const refresh: string[] = []

    invalidateFromWatcher(filesystemEvent(".git/index.lock", "change"), {
      normalize: (input) => input,
      hasFile: () => true,
      loadFile: () => {
        throw new Error("should not load")
      },
      node: () => undefined,
      isDirLoaded: () => true,
      refreshDir: (path) => refresh.push(path),
    })

    expect(refresh).toEqual([])
  })
})
