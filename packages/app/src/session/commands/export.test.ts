import { describe, expect, test } from "bun:test"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client/promise"
import type { ServerApi, ServerRequestOptions } from "@/runtime/server/api"
import type { Platform } from "@/runtime/platform/platform"
import { fetchSessionExport, saveSessionExport, sessionExportFilename } from "./export"

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions -- partial fixtures stand in for API records the export only passes through */

describe("sessionExportFilename", () => {
  test.each([
    [{ id: "ses_123", title: "Clone PR in worktree from fork" }, "clone-pr-in-worktree-from-fork.json"],
    [{ id: "ses_123", slug: "my-session-slug" }, "my-session-slug.json"],
    [{ id: "ses_123" }, "ses_123.json"],
  ])("names %o as %s", (session, filename) => {
    expect(sessionExportFilename(session)).toBe(filename)
  })
})

describe("fetchSessionExport", () => {
  test("fetches every native message page with inline media and without exporting cursors", async () => {
    const info = { id: "ses_1", title: "Test Session" } as SessionInfo
    const first = { id: "msg_1", type: "model-selected" } as unknown as SessionMessageInfo
    const second = { id: "msg_2", type: "user" } as SessionMessageInfo
    const calls: unknown[] = []

    const api = {
      session: { get: async () => info },
      message: {
        list: async (input: { cursor?: string }, options: ServerRequestOptions) => {
          calls.push([input, options])

          if (!input.cursor) return { data: [first], cursor: { next: "page-2" } }

          return { data: [second], cursor: {} }
        },
      },
    } as unknown as Pick<ServerApi, "session" | "message">

    const result = await fetchSessionExport({ sessionID: "ses_1", api })

    expect(result).toEqual({ info, messages: [first, second] })
    expect(result).not.toHaveProperty("cursor")
    expect(calls).toEqual([
      [{ sessionID: "ses_1", limit: 200, order: "asc" }, { mediaRefs: false }],
      [{ sessionID: "ses_1", limit: 200, cursor: "page-2" }, { mediaRefs: false }],
    ])
  })
})

describe("saveSessionExport", () => {
  test.each([true, false])("writes pretty JSON to the native save dialog and returns %p", async (saved) => {
    const writes: string[][] = []

    const platform: Pick<Platform, "saveFile"> = {
      saveFile: async (options, content) => {
        writes.push([options.defaultPath ?? "", content])

        return saved
      },
    }

    const data = { info: { id: "ses_1" } as SessionInfo, messages: [] }

    expect(await saveSessionExport("session.json", data, platform)).toBe(saved)
    expect(writes).toEqual([["session.json", '{\n  "info": {\n    "id": "ses_1"\n  },\n  "messages": []\n}']])
  })
})
