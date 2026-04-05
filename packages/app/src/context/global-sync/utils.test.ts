import { describe, expect, test } from "bun:test"
import type { Agent, Project } from "@opencode-ai/sdk/v2/client"
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
  const project = (patch: Partial<Project> = {}) =>
    ({
      id: "p1",
      worktree: "/tmp/project",
      time: { created: 1, updated: 1 },
      sandboxes: [],
      ...patch,
    }) as Project

  test("drops remote icon data from cached projects", () => {
    expect(
      sanitizeProject(
        project({
          icon: { url: "https://example.com/icon.png", override: "star", color: "pink" },
        }),
      ),
    ).toEqual(
      project({
        icon: { url: undefined, override: undefined, color: "pink" },
      }),
    )
  })

  test("normalizes malformed sandboxes from persisted cache", () => {
    expect(sanitizeProject(project({ sandboxes: "bad" as unknown as string[] })).sandboxes).toEqual([])
    expect(sanitizeProject(project({ sandboxes: ["/tmp/a", 1] as unknown as string[] })).sandboxes).toEqual(["/tmp/a"])
  })
})
