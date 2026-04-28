import { describe, expect, test } from "bun:test"
import type { Config, Project } from "@opencode-ai/sdk/v2/client"
import { claude, item, label, mcp, skill } from "./status-popover-data"

describe("status popover data", () => {
  test("reads plugin source from project paths", () => {
    expect(item("file:///Users/me/repo/.opencode/plugins/foo.ts")).toEqual({
      name: "foo",
      project: "repo",
      value: "file:///Users/me/repo/.opencode/plugins/foo.ts",
    })
  })

  test("reads plugin source from global paths", () => {
    expect(item("file:///Users/me/.config/opencode/plugins/foo.ts")).toEqual({
      name: "foo",
      project: "global",
      value: "file:///Users/me/.config/opencode/plugins/foo.ts",
    })
  })

  test("marks claude skills as project scoped", () => {
    const list = [
      {
        id: "p1",
        name: "workspace-a",
        worktree: "/Users/me/repo",
      },
    ] as Project[]

    expect(skill({ name: "review", location: "file:///Users/me/repo/.claude/skills/review/SKILL.md" }, list)).toEqual({
      name: "review",
      scope: "project",
      source: "workspace-a",
      value: "file:///Users/me/repo/.claude/skills/review/SKILL.md",
    })
  })

  test("marks non-project skills as global", () => {
    expect(skill({ name: "lint", location: "file:///Users/me/.config/opencode/skills/lint/SKILL.md" }, [])).toEqual({
      name: "lint",
      scope: "global",
      source: undefined,
      value: "file:///Users/me/.config/opencode/skills/lint/SKILL.md",
    })
  })

  test("prefers custom project names when present", () => {
    const list = [
      {
        id: "p1",
        name: "workspace-a",
        worktree: "/Users/me/repo",
      },
    ] as Project[]

    expect(label("/Users/me/repo", list)).toBe("workspace-a")
  })

  test("marks inherited mcp entries as global", () => {
    const global = {
      sentry: {
        type: "remote",
        url: "https://mcp.sentry.dev",
      },
    } satisfies Config["mcp"]

    expect(
      mcp("sentry", { status: "connected" }, global, global, undefined, undefined, new Set(), false, "repo"),
    ).toMatchObject({
      name: "sentry",
      project: "global",
    })
  })

  test("marks overridden mcp entries as project scoped", () => {
    const global = {
      sentry: {
        type: "remote",
        url: "https://mcp.sentry.dev",
      },
    } satisfies Config["mcp"]
    const config = {
      sentry: {
        type: "remote",
        url: "https://internal.example/mcp",
      },
    } satisfies Config["mcp"]

    expect(
      mcp("sentry", { status: "connected" }, config, global, { mcp: config }, undefined, new Set(), false, "repo"),
    ).toMatchObject({
      name: "sentry",
      project: "repo",
    })
  })

  test("marks project-only mcp entries as project scoped", () => {
    const config = {
      linear: {
        type: "remote",
        url: "https://mcp.linear.app/sse",
      },
    } satisfies Config["mcp"]

    expect(
      mcp("linear", { status: "connected" }, config, undefined, { mcp: config }, undefined, new Set(), false, "repo"),
    ).toMatchObject({
      name: "linear",
      project: "repo",
    })
  })

  test("marks plugin injected mcp entries as oh-my-openagent", () => {
    expect(
      mcp("context7", { status: "connected" }, undefined, undefined, undefined, undefined, new Set(), true, "repo"),
    ).toMatchObject({
      name: "context7",
      project: "oh-my-openagent",
    })
  })

  test("marks claude project mcp entries as project scoped", () => {
    const set = claude(
      JSON.stringify({
        projects: {
          "/Users/me/repo": {
            mcpServers: {
              context7: {
                command: "npx",
              },
            },
          },
        },
      }),
      "/Users/me/repo",
    )

    expect(mcp("context7", { status: "connected" }, undefined, undefined, undefined, undefined, set, true, "repo")).toMatchObject({
      name: "context7",
      project: "repo",
    })
  })
})
