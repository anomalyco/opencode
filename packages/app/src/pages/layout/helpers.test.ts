import { describe, expect, test } from "bun:test"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  drainPendingDeepLinks,
  parseDeepLink,
  parseNewSessionDeepLink,
} from "./deep-links"
import { type Session } from "@opencode-ai/sdk/v2/client"
import {
  attentionTitle,
  awaitingSessions,
  displayName,
  effectiveWorkspaceOrder,
  errorMessage,
  hasProjectPermissions,
  latestRootSession,
  projectAttention,
  sessionAttention,
  workspaceKey,
} from "./helpers"

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

const permission = (id: string, sessionID: string) => ({
  id,
  sessionID,
  permission: "bash",
  patterns: [],
  metadata: {},
  always: [],
})

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

  test("preserves posix and drive roots in workspace key", () => {
    expect(workspaceKey("/")).toBe("/")
    expect(workspaceKey("///")).toBe("/")
    expect(workspaceKey("C:\\")).toBe("C:/")
    expect(workspaceKey("C://")).toBe("C:/")
    expect(workspaceKey("C:///")).toBe("C:/")
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

  test("prefers project question attention after permissions", () => {
    expect(projectAttention({ permission: false, question: true, error: true, unseen: true })).toBe("question")
  })

  test("prefers project permission attention over question", () => {
    expect(projectAttention({ permission: true, question: true, error: true, unseen: true })).toBe("permission")
  })

  test("prefers session question attention over error, unseen, and working", () => {
    expect(sessionAttention({ permission: false, question: true, error: true, unseen: true, working: true })).toBe(
      "question",
    )
  })

  test("prefers session working state only when no stronger attention exists", () => {
    expect(sessionAttention({ permission: false, question: false, error: false, unseen: false, working: true })).toBe(
      "working",
    )
  })

  test("collects awaiting root sessions for child questions", () => {
    const result = awaitingSessions(
      {
        path: { directory: "/root" },
        session: [
          session({ id: "root", directory: "/root", time: { created: 1, updated: 10, archived: undefined } }),
          session({
            id: "child",
            directory: "/root",
            parentID: "root",
            time: { created: 2, updated: 20, archived: undefined },
          }),
        ],
        question: {
          child: [{ id: "q-child", sessionID: "child", questions: [] }],
        },
      },
      120_000,
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.session.id).toBe("root")
    expect(result[0]?.reason).toBe("question")
  })

  test("prefers permission over question for awaiting sessions", () => {
    const result = awaitingSessions(
      {
        path: { directory: "/root" },
        session: [session({ id: "root", directory: "/root", time: { created: 1, updated: 10, archived: undefined } })],
        permission: {
          root: [permission("perm-root", "root")],
        },
        question: {
          root: [{ id: "q-root", sessionID: "root", questions: [] }],
        },
      },
      120_000,
    )

    expect(result).toEqual([
      {
        session: expect.objectContaining({ id: "root" }),
        reason: "permission",
      },
    ])
  })

  test("filters out auto-approved awaiting permissions", () => {
    const result = awaitingSessions(
      {
        path: { directory: "/root" },
        session: [session({ id: "root", directory: "/root", time: { created: 1, updated: 10, archived: undefined } })],
        permission: {
          root: [permission("perm-root", "root")],
        },
      },
      120_000,
      () => false,
    )

    expect(result).toEqual([])
  })

  test("formats attention title with count", () => {
    expect(attentionTitle("OpenCode", 0)).toBe("OpenCode")
    expect(attentionTitle("OpenCode", 2)).toBe("(2) OpenCode")
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
