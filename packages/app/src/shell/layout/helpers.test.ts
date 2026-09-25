import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import {
  childSessionOnPath,
  closeHomeProject,
  compareSessionTime,
  displayName,
  effectiveWorkspaceOrder,
  errorMessage,
  hasProjectPermissions,
  homeProjectNavigation,
  homeProjectDirectories,
  homeSessionServerStatus,
  latestRootSession,
  projectForSession,
  resolveProjectForSession,
  resolveSessionDetailsProject,
  sortedRootSessions,
  toggleHomeProjectSelection,
} from "./helpers"
import { pathKey } from "@/workspaces/path-key"
import { ServerConnection } from "@/runtime/server/registry"

const serverKey = ServerConnection.Key.make

const session = (input: Partial<SessionInfo> & Pick<SessionInfo, "id"> & { directory: string }) =>
  ({
    projectID: "project",
    title: "",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    parentID: undefined,
    time: { created: 0, updated: 0, archived: undefined },
    ...input,
    location: { directory: input.directory },
    directory: undefined,
  }) as SessionInfo

describe("layout workspace helpers", () => {
  test("normalizes trailing slash in workspace key", () => {
    expect(String(pathKey("/tmp/demo///"))).toBe("/tmp/demo")
    expect(String(pathKey("C:\\tmp\\demo\\\\"))).toBe("C:/tmp/demo")
  })

  test("preserves posix and drive roots in workspace key", () => {
    expect(String(pathKey("/"))).toBe("/")
    expect(String(pathKey("///"))).toBe("/")
    expect(String(pathKey("C:\\"))).toBe("C:/")
    expect(String(pathKey("C://"))).toBe("C:/")
    expect(String(pathKey("C:///"))).toBe("C:/")
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

  test("sorts recent sessions by persisted update time instead of id", () => {
    const result = sortedRootSessions(
      {
        path: { directory: "/workspace" },
        session: [
          session({ id: "ses_z", directory: "/workspace", time: { created: 1, updated: 2, archived: undefined } }),
          session({ id: "ses_a", directory: "/workspace", time: { created: 1, updated: 3, archived: undefined } }),
        ],
      },
      3,
    )

    expect(result.map((item) => item.id)).toEqual(["ses_a", "ses_z"])
  })

  test("uses id only to break equal session timestamps", () => {
    const sessions = [
      session({ id: "ses_z", directory: "/workspace", time: { created: 1, updated: 2, archived: undefined } }),
      session({ id: "ses_a", directory: "/workspace", time: { created: 1, updated: 2, archived: undefined } }),
    ]

    expect(sessions.sort(compareSessionTime).map((item) => item.id)).toEqual(["ses_a", "ses_z"])
  })

  test("detects project permissions with a filter", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }, { id: "perm-hidden" }],
        child: [{ id: "perm-child" }],
      },
      (item) => item.id === "perm-child",
    )

    expect(result).toBe(true)
  })

  test("ignores project permissions filtered out", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }],
      },
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

  test("finds the direct child on the active session path", () => {
    const list = [
      session({ id: "root", directory: "/workspace" }),
      session({ id: "child", directory: "/workspace", parentID: "root" }),
      session({ id: "leaf", directory: "/workspace", parentID: "child" }),
    ]

    expect(childSessionOnPath(list, "root", "leaf")?.id).toBe("child")
    expect(childSessionOnPath(list, "child", "leaf")?.id).toBe("leaf")
    expect(childSessionOnPath(list, "root", "root")).toBeUndefined()
    expect(childSessionOnPath(list, "root", "other")).toBeUndefined()
  })

  test("keeps the enriched workspace inventory when matching a session by project id", () => {
    const project = {
      id: "project",
      worktree: "/repo",
      sandboxes: ["/workspaces/feature"],
      worktrees: [{ directory: "/repo" }, { directory: "/workspaces/feature", strategy: "git" }],
    }

    expect(projectForSession(session({ id: "feature", directory: "/workspaces/feature/packages/app" }), [project])).toBe(
      project,
    )
  })

  test("finds the enriched project for a nested workspace when its session project id is stale", () => {
    const project = { id: "updated", worktree: "/repo", sandboxes: ["/workspaces/feature"] }

    expect(projectForSession(session({ id: "feature", directory: "/workspaces/feature/packages/app" }), [project])).toBe(
      project,
    )
  })

  test("prefers the session directory among opened projects sharing an ID", () => {
    const primary = { id: "project", worktree: "/repo", icon: { override: "primary" } }
    const nested = { id: "project", worktree: "/repo/packages/app", icon: { override: "nested" } }
    expect(projectForSession(session({ id: "nested", directory: nested.worktree }), [nested, primary])).toBe(nested)
    expect(projectForSession(session({ id: "primary", directory: primary.worktree }), [primary, nested])).toBe(primary)
    expect(projectForSession(session({ id: "child", directory: `${nested.worktree}/src` }), [nested, primary])).toBe(
      nested,
    )
  })

  test("retains project ID ownership when a different project's directory overlaps", () => {
    const owner = { id: "owner", worktree: "/repo" }
    const overlap = { id: "other", worktree: "/repo/subdir" }
    expect(
      projectForSession(session({ id: "nested", projectID: "owner", directory: overlap.worktree }), [owner, overlap]),
    ).toBe(owner)
  })

  test("prefers the nested opened project over an ancestor while its ID is loading", () => {
    const documents = { id: "documents", worktree: "/documents", icon: { override: "documents-icon" } }
    const child = { worktree: "/documents/project", icon: { override: "child-icon" } }
    const current = session({ id: "child", projectID: "child", directory: child.worktree })

    expect(projectForSession(current, [documents, child])).toBe(child)
  })

  test("prefers an opened directory over an ancestor's sandbox pointing at that directory", () => {
    const documents = { id: "shared", worktree: "/documents", sandboxes: ["/documents/project"] }
    const child = { id: "shared", worktree: "/documents/project" }
    const current = session({ id: "child", projectID: "shared", directory: child.worktree })

    expect(projectForSession(current, [documents, child])).toBe(child)
  })

  test("does not use an opened ancestor when the session's project is only in stored metadata", () => {
    const documents = { id: "documents", worktree: "/documents", icon: { override: "documents-icon" } }
    const child = { id: "child", worktree: "/documents/project", icon: { override: "child-icon" } }
    const current = session({ id: "child", projectID: "child", directory: child.worktree })

    expect(resolveProjectForSession(current, [documents], [child])).toBe(child)
  })

  test("keeps the exact opened project's enriched icon while its ID is loading", () => {
    const documents = { id: "documents", worktree: "/documents", icon: { override: "documents-icon" } }
    const child = { worktree: "/documents/project", icon: { override: "child-local-icon" } }
    const synced = { id: "child", worktree: child.worktree, icon: { override: "child-server-icon" } }
    const current = session({ id: "child", projectID: synced.id, directory: child.worktree })

    expect(resolveProjectForSession(current, [documents, child], [synced])).toBe(child)
  })

  test("prefers an unresolved exact project only when stored ID confirms its canonical directory", () => {
    const parent = { id: "shared", worktree: "/documents", icon: { override: "parent-icon" } }
    const nested = { worktree: "/documents/project", icon: { override: "nested-icon" } }
    const stored = { id: "shared", worktree: nested.worktree, icon: { override: "stored-icon" } }
    const current = session({ id: "nested", projectID: stored.id, directory: nested.worktree })

    expect(resolveProjectForSession(current, [parent, nested], [stored])).toBe(nested)
    expect(resolveProjectForSession(current, [parent, nested], [{ ...stored, worktree: parent.worktree }])).toBe(parent)
  })

  test("merges opened appearance without changing canonical workspace metadata", () => {
    const metadata = {
      id: "project",
      worktree: "/repo",
      name: "Repo",
      icon: { url: "server-icon" },
      sandboxes: ["/repo/workspace"],
      worktrees: [{ directory: "/repo/workspace" }],
      vcs: "git",
    }
    const opened = { id: metadata.id, worktree: "/repo/workspace", icon: { override: "workspace-icon" } }
    const current = session({ id: "workspace", projectID: metadata.id, directory: opened.worktree })

    const merged = resolveSessionDetailsProject(current, [opened], [metadata])
    if (!merged) throw new Error("Expected session details project")
    expect(merged.id).toBe(metadata.id)
    expect(merged.worktree).toBe(metadata.worktree)
    expect(merged.worktrees).toBe(metadata.worktrees)
    expect(merged.sandboxes).toBe(metadata.sandboxes)
    expect(merged.vcs).toBe(metadata.vcs)
    expect(merged.name).toBe("workspace")
    expect(Object.entries(merged.icon ?? {})).toEqual(Object.entries(opened.icon))
    expect(resolveSessionDetailsProject(current, [], [metadata])).toBe(metadata)
  })

  test("nested details keep child metadata and the pending opened child's icon", () => {
    const documents = { id: "documents", worktree: "/documents", icon: { override: "parent-icon" } }
    const opened = { worktree: "/documents/project", icon: { override: "child-icon" } }
    const stored = { id: "child", worktree: opened.worktree, icon: { override: "server-icon" }, sandboxes: [] }
    const current = session({ id: "child", projectID: stored.id, directory: opened.worktree })

    const details = resolveSessionDetailsProject(current, [documents, opened], [stored])
    expect(details?.id).toBe(stored.id)
    expect(details?.worktree).toBe(stored.worktree)
    expect(details?.icon?.override).toBe("child-icon")
  })

  test("formats fallback project display name", () => {
    expect(displayName({ worktree: "/tmp/app" })).toBe("app")
    expect(displayName({ worktree: "/tmp/app", name: "My App" })).toBe("My App")
    expect(displayName({ worktree: "/" })).toBe("/")
  })

  test("scopes home project selection by server", () => {
    expect(
      toggleHomeProjectSelection(undefined, serverKey("https://debian.example"), "/home/luke/repos/amazon"),
    ).toEqual({
      server: serverKey("https://debian.example"),
      directory: "/home/luke/repos/amazon",
    })
    expect(
      toggleHomeProjectSelection(
        { server: serverKey("https://windows.example"), directory: "/home/luke/repos/amazon" },
        serverKey("https://debian.example"),
        "/home/luke/repos/amazon",
      ),
    ).toEqual({ server: serverKey("https://debian.example"), directory: "/home/luke/repos/amazon" })
    expect(
      toggleHomeProjectSelection(
        { server: serverKey("https://debian.example"), directory: "/home/luke/repos/amazon" },
        serverKey("https://debian.example"),
        "/home/luke/repos/amazon",
      ),
    ).toEqual({ server: serverKey("https://debian.example") })
  })

  test("closes a home project through its server context", () => {
    const closed: string[] = []

    expect(
      closeHomeProject(
        { server: serverKey("https://windows.example"), directory: "/shared" },
        serverKey("https://debian.example"),
        { close: (directory) => closed.push(directory) },
        "/shared",
      ),
    ).toEqual({ server: serverKey("https://windows.example"), directory: "/shared" })
    expect(closed).toEqual(["/shared"])
    expect(
      closeHomeProject(
        { server: serverKey("https://debian.example"), directory: "/shared" },
        serverKey("https://debian.example"),
        { close: (directory) => closed.push(directory) },
        "/shared",
      ),
    ).toEqual({ server: serverKey("https://debian.example") })
  })

  test("defers home project navigation until its server is active", () => {
    expect(
      homeProjectNavigation(serverKey("sidecar"), serverKey("https://debian.example"), "/YW1hem9u/session"),
    ).toEqual({
      server: serverKey("https://debian.example"),
      href: "/YW1hem9u/session",
    })
    expect(
      homeProjectNavigation(
        serverKey("https://debian.example"),
        serverKey("https://debian.example"),
        "/YW1hem9u/session",
      ),
    ).toEqual({
      href: "/YW1hem9u/session",
    })
  })

  test("preserves picker order when adding multiple projects", () => {
    expect(homeProjectDirectories(["/first", "/second"])).toEqual(["/first", "/second"])
    expect(homeProjectDirectories("/only")).toEqual(["/only"])
    expect(homeProjectDirectories(null)).toEqual([])
  })

  test("hides status derived from an inactive server", () => {
    let reads = 0
    const status = () => {
      reads++
      return { working: true, tint: "red" }
    }
    expect(homeSessionServerStatus(false, status)).toEqual({
      working: false,
      tint: undefined,
    })
    expect(reads).toBe(0)
    expect(homeSessionServerStatus(true, status)).toEqual({
      working: true,
      tint: "red",
    })
    expect(reads).toBe(1)
  })

  test("extracts api error message and fallback", () => {
    expect(errorMessage({ data: { message: "boom" } }, "fallback")).toBe("boom")
    expect(errorMessage(new Error("broken"), "fallback")).toBe("broken")
    expect(errorMessage("unknown", "fallback")).toBe("fallback")
  })
})
