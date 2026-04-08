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
  test("clones nested project data and strips cached icon urls", () => {
    const [store] = createStore({
      value: {
        id: "proj_1",
        worktree: "/tmp/project",
        name: "Project",
        icon: {
          url: "https://example.com/icon.png",
          override: "data:image/png;base64,abc",
          color: "pink",
        },
        commands: {
          start: "bun dev",
        },
        time: {
          created: 1,
          updated: 2,
        },
        sandboxes: ["/tmp/project-a"],
      } satisfies Project,
    })

    const next = sanitizeProject(store.value)

    expect(next).not.toBe(store.value)
    expect(next.time).not.toBe(store.value.time)
    expect(next.sandboxes).not.toBe(store.value.sandboxes)
    expect(next.commands).not.toBe(store.value.commands)
    expect(next.icon).not.toBe(store.value.icon)
    expect(next.icon?.url).toBeUndefined()
    expect(next.icon?.override).toBeUndefined()
    expect(next.icon?.color).toBe("pink")

    next.sandboxes.push("/tmp/project-b")
    expect(store.value.sandboxes).toEqual(["/tmp/project-a"])
  })

  test("returns a detached copy even without icon overrides", () => {
    const project = {
      id: "proj_2",
      worktree: "/tmp/project-2",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    } satisfies Project

    const next = sanitizeProject(project)

    expect(next).not.toBe(project)
    expect(next.time).not.toBe(project.time)
    expect(next.sandboxes).not.toBe(project.sandboxes)
  })
})
