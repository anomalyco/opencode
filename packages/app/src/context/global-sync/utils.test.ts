import { describe, expect, test } from "bun:test"
import type { Agent, Project } from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import { normalizeAgentList, sanitizeProject } from "./utils"

const agent = (name = "build") =>
  ({
    name,
    mode: "primary",
    permission: {},
    options: {},
  }) as Agent

describe("normalizeAgentList", () => {
  test("keeps array payloads", () => {
    expect(normalizeAgentList([agent("build"), agent("docs")])).toEqual([agent("build"), agent("docs")])
  })

  test("wraps a single agent payload", () => {
    expect(normalizeAgentList(agent("docs"))).toEqual([agent("docs")])
  })

  test("extracts agents from keyed objects", () => {
    expect(
      normalizeAgentList({
        build: agent("build"),
        docs: agent("docs"),
      }),
    ).toEqual([agent("build"), agent("docs")])
  })

  test("drops invalid payloads", () => {
    expect(normalizeAgentList({ name: "AbortError" })).toEqual([])
    expect(normalizeAgentList([{ name: "build" }, agent("docs")])).toEqual([agent("docs")])
  })
})

describe("sanitizeProject", () => {
  test("returns a plain clone for store-backed projects", () => {
    const [store] = createStore({
      project: [
        {
          id: "p1",
          name: "repo",
          worktree: "/repo",
          sandboxes: ["/repo/a"],
          icon: {},
        },
      ] as Project[],
    })

    const next = sanitizeProject(store.project[0]!)
    expect(next).toEqual(store.project[0])
    expect(next).not.toBe(store.project[0])
    expect(next.sandboxes).not.toBe(store.project[0]?.sandboxes)
  })
})
