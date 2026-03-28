import { describe, expect, test } from "bun:test"
import { collectDeepLinks, drainPendingDeepLinks, parseDeepLink } from "./deep-links"
import { type Session } from "@opencode-ai/sdk/v2/client"
import {
  displayName,
  effectiveWorkspaceOrder,
  errorMessage,
  hasProjectPermissions,
  latestRootSession,
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

describe("layout deep links", () => {
  test("parses open-project deep links", () => {
    expect(parseDeepLink("opencode://open-project?directory=/tmp/demo")).toEqual({
      type: "open-project",
      directory: "/tmp/demo",
    })
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
      expect(parseDeepLink("opencode://open-project?directory=/tmp/demo")).toEqual({
        type: "open-project",
        directory: "/tmp/demo",
      })
    } finally {
      if (original) Object.defineProperty(URL, "canParse", original)
      if (!original) Reflect.deleteProperty(URL, "canParse")
    }
  })

  test("ignores open-project deep links without directory", () => {
    expect(parseDeepLink("opencode://open-project")).toBeUndefined()
    expect(parseDeepLink("opencode://open-project?directory=")).toBeUndefined()
  })

  test("parses new-session deep links with optional prompt", () => {
    expect(parseDeepLink("opencode://new-session?directory=/tmp/demo")).toEqual({
      type: "new-session",
      directory: "/tmp/demo",
    })
    expect(parseDeepLink("opencode://new-session?directory=/tmp/demo&prompt=hello%20world")).toEqual({
      type: "new-session",
      directory: "/tmp/demo",
      prompt: "hello world",
    })
  })

  test("parses open-session deep links with optional message", () => {
    expect(parseDeepLink("opencode://open-session?directory=/tmp/demo&id=session-1")).toEqual({
      type: "open-session",
      directory: "/tmp/demo",
      id: "session-1",
    })
    expect(parseDeepLink("opencode://open-session?directory=/tmp/demo&id=session-1&message=msg-1")).toEqual({
      type: "open-session",
      directory: "/tmp/demo",
      id: "session-1",
      message: "msg-1",
    })
  })

  test("parses desktop dialog deep links", () => {
    expect(parseDeepLink("opencode://settings")).toEqual({ type: "settings" })
    expect(parseDeepLink("opencode://server")).toEqual({ type: "server" })
    expect(parseDeepLink("opencode://provider")).toEqual({ type: "provider" })
    expect(parseDeepLink("opencode://edit-project?directory=/tmp/demo")).toEqual({
      type: "edit-project",
      directory: "/tmp/demo",
    })
  })

  test("ignores new-session deep links without directory", () => {
    expect(parseDeepLink("opencode://new-session")).toBeUndefined()
    expect(parseDeepLink("opencode://new-session?directory=")).toBeUndefined()
  })

  test("ignores open-session deep links without required params", () => {
    expect(parseDeepLink("opencode://open-session")).toBeUndefined()
    expect(parseDeepLink("opencode://open-session?directory=/tmp/demo")).toBeUndefined()
    expect(parseDeepLink("opencode://open-session?id=session-1")).toBeUndefined()
  })

  test("ignores edit-project deep links without directory", () => {
    expect(parseDeepLink("opencode://edit-project")).toBeUndefined()
    expect(parseDeepLink("opencode://edit-project?directory=")).toBeUndefined()
  })

  test("collects only valid deep links", () => {
    const result = collectDeepLinks([
      "opencode://open-project?directory=/a",
      "opencode://other?directory=/b",
      "opencode://new-session?directory=/c&prompt=ship%20it",
      "opencode://open-session?directory=/d&id=session-1&message=msg-1",
      "opencode://settings",
      "opencode://edit-project?directory=/e",
    ])
    expect(result).toEqual([
      { type: "open-project", directory: "/a" },
      { type: "new-session", directory: "/c", prompt: "ship it" },
      { type: "open-session", directory: "/d", id: "session-1", message: "msg-1" },
      { type: "settings" },
      { type: "edit-project", directory: "/e" },
    ])
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
