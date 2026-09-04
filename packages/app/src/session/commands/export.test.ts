import { describe, expect, test } from "bun:test"
import type { SessionInfo, SessionMessageInfo } from "@opencode-ai/client/promise"
import type { ServerApi } from "@/runtime/server/api"
import type { Platform } from "@/runtime/platform/platform"
import { fetchSessionExport, saveSessionExport, sessionExportFilename } from "./export"

describe("sessionExportFilename", () => {
  test("generates filename from title", () => {
    expect(sessionExportFilename({ id: "ses_123", title: "Clone PR in worktree from fork" })).toBe(
      "clone-pr-in-worktree-from-fork.json",
    )
  })

  test("generates filename from slug when title missing", () => {
    expect(sessionExportFilename({ id: "ses_123", slug: "my-session-slug" })).toBe("my-session-slug.json")
  })

  test("falls back to id when title and slug are empty", () => {
    expect(sessionExportFilename({ id: "ses_123" })).toBe("ses_123.json")
  })
})

describe("fetchSessionExport", () => {
  test("fetches every native message page without exporting cursors", async () => {
    const info = { id: "ses_1", title: "Test Session" } as SessionInfo
    const first = { id: "msg_1", type: "model-selected" } as unknown as SessionMessageInfo
    const second = { id: "msg_2", type: "user" } as SessionMessageInfo
    const calls: unknown[] = []
    const api = {
      session: { get: async () => info },
      message: {
        list: async (input: { cursor?: string }) => {
          calls.push(input)
          if (!input.cursor) return { data: [first], cursor: { next: "page-2" } }
          return { data: [second], cursor: {} }
        },
      },
    } as unknown as Pick<ServerApi, "session" | "message">

    const result = await fetchSessionExport({ sessionID: "ses_1", api })

    expect(result).toEqual({ info, messages: [first, second] })
    expect(result).not.toHaveProperty("cursor")
    expect(calls).toEqual([
      { sessionID: "ses_1", limit: 200, order: "asc" },
      { sessionID: "ses_1", limit: 200, cursor: "page-2" },
    ])
  })

  test("propagates session lookup failures", async () => {
    const api = {
      session: { get: async () => Promise.reject(new Error("Session not found")) },
      message: { list: async () => ({ data: [], cursor: {} }) },
    } as unknown as Pick<ServerApi, "session" | "message">

    expect(fetchSessionExport({ sessionID: "ses_missing", api })).rejects.toThrow("Session not found")
  })
})

describe("saveSessionExport", () => {
  test("returns false when the native save dialog is cancelled", async () => {
    const calls: string[][] = []
    const platform: Pick<Platform, "saveFile"> = {
      saveFile: async (_options, content) => {
        calls.push([content])
        return false
      },
    }

    expect(await saveSessionExport("session.json", { id: "ses_1" }, platform)).toBe(false)
    expect(calls).toEqual([['{\n  "id": "ses_1"\n}']])
  })

  test("passes serialized data to the native save operation", async () => {
    const writes: string[][] = []
    const platform: Pick<Platform, "saveFile"> = {
      saveFile: async (options, content) => {
        writes.push([options.defaultPath ?? "", content])
        return true
      },
    }

    expect(await saveSessionExport("session.json", { id: "ses_1" }, platform)).toBe(true)
    expect(writes).toEqual([["session.json", '{\n  "id": "ses_1"\n}']])
  })
})
