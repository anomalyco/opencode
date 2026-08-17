import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import type { Project } from "@/types"
import type { State } from "./types"
import { applyDirectoryEvent, applyGlobalEvent } from "./event-reducer"

describe("applyGlobalEvent", () => {
  test("upserts project.updated in sorted position", () => {
    const projects = [{ id: "b", worktree: "/b" }] as Project[]
    let next = projects
    applyGlobalEvent({
      event: { type: "project.updated", properties: { id: "a", worktree: "/a" } },
      project: projects,
      setGlobalProject: (value) => {
        next = typeof value === "function" ? value(next) : value
      },
      refresh() {},
    })
    expect(next.map((project) => project.id)).toEqual(["a", "b"])
  })

  test("refreshes on global disposal", () => {
    let refreshed = false
    applyGlobalEvent({
      event: { type: "global.disposed" },
      project: [],
      setGlobalProject() {},
      refresh: () => (refreshed = true),
    })
    expect(refreshed).toBe(true)
  })
})

describe("applyDirectoryEvent", () => {
  test("updates vcs and routes refresh events", () => {
    const [store, setStore] = createStore({ vcs: { branch: "old" } } as State)
    const pushed: string[] = []
    let lsp = 0
    let references = 0
    const apply = (type: string, properties?: unknown) =>
      applyDirectoryEvent({
        event: { type, properties },
        store,
        setStore,
        directory: "/repo",
        push: (directory) => pushed.push(directory),
        loadLsp: () => lsp++,
        loadReferences: () => references++,
      })

    apply("vcs.branch.updated", { branch: "main" })
    apply("server.instance.disposed")
    apply("lsp.updated")
    apply("reference.updated")

    expect(store.vcs?.branch).toBe("main")
    expect(pushed).toEqual(["/repo"])
    expect(lsp).toBe(1)
    expect(references).toBe(1)
  })
})
