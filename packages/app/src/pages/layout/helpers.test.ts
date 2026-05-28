import { describe, expect, test } from "bun:test"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  drainPendingDeepLinks,
  parseDeepLink,
  parseNewSessionDeepLink,
} from "./deep-links"
import { type PermissionRequest, type Session } from "@opencode-ai/sdk/v2/client"
import {
  canonicalWorkspaceDir,
  displayName,
  effectiveWorkspaceOrder,
  errorMessage,
  hasProjectPermissions,
  latestProjectSession,
  latestRootSession,
  projectOwner,
  sortedProjectSessions,
  latestWorkspaceSession,
  waitForMatch,
  workspaceKey,
} from "./helpers"
import { projectSelected } from "./sidebar-project-helpers"
import type { Project } from "@opencode-ai/sdk/v2"

const session = (input: Partial<Session> & Pick<Session, "id" | "directory">) =>
  ({
    title: "",
    version: "v2",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    time: { created: 0, updated: 0, archived: undefined },
    ...input,
  }) as Session

describe("layout deep links", () => {
  test("parses open-project deep links", () => {
    expect(parseDeepLink("opencode://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
  })

  test("ignores non-project deep links", () => {
    expect(parseDeepLink("opencode://other?directory=/tmp/demo")).toBeUndefined()
    expect(parseDeepLink("https://example.com")).toBeUndefined()
  })

  test("ignores malformed deep links safely", () => {
    expect(() => parseDeepLink("opencode://open-project/%E0%A4%A%")).not.toThrow()
    expect(parseDeepLink("opencode://open-project/%E0%A4%A%")).toBeUndefined()
  })

  test("parses links when URL.canParse is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(URL, "canParse")
    Object.defineProperty(URL, "canParse", { configurable: true, value: undefined })
    try {
      expect(parseDeepLink("opencode://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
    } finally {
      if (original) Object.defineProperty(URL, "canParse", original)
      if (!original) Reflect.deleteProperty(URL, "canParse")
    }
  })

  test("ignores open-project deep links without directory", () => {
    expect(parseDeepLink("opencode://open-project")).toBeUndefined()
    expect(parseDeepLink("opencode://open-project?directory=")).toBeUndefined()
  })

  test("collects only valid open-project directories", () => {
    const result = collectOpenProjectDeepLinks([
      "opencode://open-project?directory=/a",
      "opencode://other?directory=/b",
      "opencode://open-project?directory=/c",
    ])
    expect(result).toEqual(["/a", "/c"])
  })

  test("parses new-session deep links with optional prompt", () => {
    expect(parseNewSessionDeepLink("opencode://new-session?directory=/tmp/demo")).toEqual({ directory: "/tmp/demo" })
    expect(parseNewSessionDeepLink("opencode://new-session?directory=/tmp/demo&prompt=hello%20world")).toEqual({
      directory: "/tmp/demo",
      prompt: "hello world",
    })
  })

  test("ignores new-session deep links without directory", () => {
    expect(parseNewSessionDeepLink("opencode://new-session")).toBeUndefined()
    expect(parseNewSessionDeepLink("opencode://new-session?directory=")).toBeUndefined()
  })

  test("collects only valid new-session deep links", () => {
    const result = collectNewSessionDeepLinks([
      "opencode://new-session?directory=/a",
      "opencode://open-project?directory=/b",
      "opencode://new-session?directory=/c&prompt=ship%20it",
    ])
    expect(result).toEqual([{ directory: "/a" }, { directory: "/c", prompt: "ship it" }])
  })

  test("drains global deep links once", () => {
    const target = {
      __OPENCODE__: {
        deepLinks: ["opencode://open-project?directory=/a"],
      },
    } as unknown as Window & { __OPENCODE__?: { deepLinks?: string[] } }

    expect(drainPendingDeepLinks(target)).toEqual(["opencode://open-project?directory=/a"])
    expect(drainPendingDeepLinks(target)).toEqual([])
  })
})

describe("layout workspace helpers", () => {
  test("normalizes trailing slash in workspace key", () => {
    expect(workspaceKey("/tmp/demo///")).toBe("/tmp/demo")
    expect(workspaceKey("C:\\tmp\\demo\\\\")).toBe("C:/tmp/demo")
  })

  test("matches selected project against normalized workspace paths", () => {
    expect(projectSelected("/tmp/demo///", "/tmp/demo")).toBe(true)
    expect(projectSelected("/tmp/other", "/tmp/demo", ["/tmp/sandbox"])).toBe(false)
  })

  test("does not select a project from unrelated sandbox metadata", () => {
    const tile = { worktree: "/p", sandboxes: ["/q/sandbox"] } satisfies Partial<Project>
    expect(projectSelected("/c", tile.worktree!, tile.sandboxes)).toBe(false)
  })

  test("does not select a project from stale sandbox metadata after owner resolution", () => {
    expect(projectSelected("/repo", "/old", ["/repo"])).toBe(false)
  })

  test("prefers exact project worktree over stale sandbox ownership", () => {
    const projects = [
      { worktree: "/old", sandboxes: ["/repo"] },
      { worktree: "/repo", sandboxes: [] },
    ]

    const owner = projectOwner("/repo", projects)

    expect(owner?.root).toBe("/repo")
    expect(owner?.project.worktree).toBe("/repo")
    expect(owner?.sandbox).toBe(false)
  })

  test("falls back to sandbox ownership only without a project worktree match", () => {
    const projects = [{ worktree: "/repo", sandboxes: ["/repo-wt"] }]

    const owner = projectOwner("/repo-wt", projects)

    expect(owner?.root).toBe("/repo")
    expect(owner?.directory).toBe("/repo-wt")
    expect(owner?.sandbox).toBe(true)
  })

  test("preserves posix and drive roots in workspace key", () => {
    expect(workspaceKey("/")).toBe("/")
    expect(workspaceKey("///")).toBe("/")
    expect(workspaceKey("C:\\")).toBe("C:/")
    expect(workspaceKey("C://")).toBe("C:/")
    expect(workspaceKey("C:///")).toBe("C:/")
  })

  test("uses canonical workspace dir only for the same workspace", () => {
    expect(canonicalWorkspaceDir("/tmp/demo///", "/tmp/demo")).toBe("/tmp/demo")
    expect(canonicalWorkspaceDir("/tmp/p", "/tmp/s")).toBe("/tmp/p")
  })

  test("waits for async state to match before continuing", async () => {
    let key = "openclaw"
    setTimeout(() => {
      key = "sidecar"
    }, 0)

    await waitForMatch(
      () => key,
      (value) => value === "sidecar",
      { tries: 10, delay: 1 },
    )

    expect(key).toBe("sidecar")
  })

  test("keeps local first while preserving known order", () => {
    const result = effectiveWorkspaceOrder("/root", ["/root", "/b", "/c"], ["/root", "/c", "/a", "/b"])
    expect(result).toEqual(["/root", "/c", "/b"])
  })

  test("finds the latest root session across workspaces", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/root" },
          session: [session({ id: "root", directory: "/root", time: { created: 1, updated: 1, archived: undefined } })],
        },
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "workspace",
              directory: "/workspace",
              time: { created: 2, updated: 2, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("workspace")
  })

  test("sorts project root sessions across workspaces", () => {
    const result = sortedProjectSessions(
      [
        {
          path: { directory: "/root" },
          session: [
            session({
              id: "child",
              directory: "/root",
              parentID: "root",
              time: { created: 9, updated: 9, archived: undefined },
            }),
            session({
              id: "root",
              directory: "/root",
              time: { created: 1, updated: 1, archived: undefined },
            }),
          ],
        },
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "archived",
              directory: "/workspace",
              time: { created: 8, updated: 8, archived: 8 },
            }),
            session({
              id: "workspace",
              directory: "/workspace",
              time: { created: 2, updated: 2, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result.map((item) => item.id)).toEqual(["workspace", "root"])
  })

  test("sorts recently updated sessions by timestamp before id", () => {
    const result = sortedProjectSessions(
      [
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "a",
              directory: "/workspace",
              time: { created: 10, updated: 10, archived: undefined },
            }),
            session({
              id: "b",
              directory: "/workspace",
              time: { created: 20, updated: 20, archived: undefined },
            }),
          ],
        },
      ],
      60_000,
    )

    expect(result.map((item) => item.id)).toEqual(["b", "a"])
  })

  test("finds the latest root session inside one workspace only", () => {
    const result = latestWorkspaceSession(
      {
        path: { directory: "/workspace" },
        session: [
          session({
            id: "child",
            directory: "/workspace",
            parentID: "root",
            time: { created: 3, updated: 3, archived: undefined },
          }),
          session({
            id: "root-old",
            directory: "/workspace",
            time: { created: 1, updated: 1, archived: undefined },
          }),
          session({
            id: "root-new",
            directory: "/workspace",
            time: { created: 2, updated: 2, archived: undefined },
          }),
        ],
      },
      120_000,
    )

    expect(result?.id).toBe("root-new")
  })

  test("ignores archived remembered sessions when selecting a workspace session", () => {
    const result = latestWorkspaceSession(
      {
        path: { directory: "/workspace" },
        session: [
          session({
            id: "archived",
            directory: "/workspace",
            time: { created: 4, updated: 4, archived: 4 },
          }),
          session({
            id: "root",
            directory: "/workspace",
            time: { created: 1, updated: 1, archived: undefined },
          }),
        ],
      },
      120_000,
    )

    expect(result?.id).toBe("root")
  })

  test("detects project permissions with a filter", () => {
    const result = hasProjectPermissions(
      [session({ id: "root", directory: "/root" }), session({ id: "child", directory: "/root", parentID: "root" })],
      {
        root: [{ id: "perm-root" } as PermissionRequest, { id: "perm-hidden" } as PermissionRequest],
        child: [{ id: "perm-child" } as PermissionRequest],
      },
      "/root",
      (item: PermissionRequest) => item.id === "perm-child",
    )

    expect(result).toBe(true)
  })

  test("ignores project permissions filtered out", () => {
    const result = hasProjectPermissions(
      [session({ id: "root", directory: "/root" })],
      {
        root: [{ id: "perm-root" } as PermissionRequest],
      },
      "/root",
      () => false,
    )

    expect(result).toBe(false)
  })

  test("ignores archived and child sessions when finding latest root session", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "archived",
              directory: "/workspace",
              time: { created: 10, updated: 10, archived: 10 },
            }),
            session({
              id: "child",
              directory: "/workspace",
              parentID: "parent",
              time: { created: 20, updated: 20, archived: undefined },
            }),
            session({
              id: "root",
              directory: "/workspace",
              time: { created: 30, updated: 30, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("root")
  })

  test("prefers remembered project session when it still exists", () => {
    const result = latestProjectSession(
      {
        root: "/root",
        dirs: ["/root", "/workspace"],
        recent: { directory: "/root", id: "older", at: 999 },
        stores: [
          {
            path: { directory: "/root" },
            session: [
              session({
                id: "older",
                directory: "/root",
                time: { created: 1, updated: 1, archived: undefined },
              }),
            ],
          },
          {
            path: { directory: "/workspace" },
            session: [
              session({
                id: "newer",
                directory: "/workspace",
                time: { created: 2, updated: 2, archived: undefined },
              }),
            ],
          },
        ],
      },
      120_000,
    )

    expect(result?.id).toBe("older")
  })

  test("falls back to latest root session when remembered project session is gone", () => {
    const result = latestProjectSession(
      {
        root: "/root",
        dirs: ["/root", "/workspace"],
        recent: { directory: "/missing", id: "older", at: 999 },
        stores: [
          {
            path: { directory: "/root" },
            session: [
              session({
                id: "root",
                directory: "/root",
                time: { created: 1, updated: 1, archived: undefined },
              }),
            ],
          },
          {
            path: { directory: "/workspace" },
            session: [
              session({
                id: "workspace",
                directory: "/workspace",
                time: { created: 2, updated: 2, archived: undefined },
              }),
            ],
          },
        ],
      },
      120_000,
    )

    expect(result?.id).toBe("workspace")
  })

  test("ignores stores outside the requested project", () => {
    const result = latestProjectSession(
      {
        root: "/root",
        dirs: ["/root", "/workspace"],
        recent: { directory: "/other", id: "other", at: 999 },
        stores: [
          {
            path: { directory: "/root" },
            session: [
              session({
                id: "root",
                directory: "/root",
                time: { created: 1, updated: 1, archived: undefined },
              }),
            ],
          },
          {
            path: { directory: "/other" },
            session: [
              session({
                id: "other",
                directory: "/other",
                time: { created: 99, updated: 99, archived: undefined },
              }),
            ],
          },
        ],
      },
      120_000,
    )

    expect(result?.id).toBe("root")
  })

  test("formats fallback project display name", () => {
    expect(displayName({ worktree: "/tmp/app" })).toBe("app")
    expect(displayName({ worktree: "/tmp/app", name: "My App" })).toBe("My App")
  })

  test("extracts api error message and fallback", () => {
    expect(errorMessage({ data: { message: "boom" } }, "fallback")).toBe("boom")
    expect(errorMessage(new Error("broken"), "fallback")).toBe("broken")
    expect(errorMessage("unknown", "fallback")).toBe("fallback")
  })
})
