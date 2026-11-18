import { describe, expect, test } from "bun:test"
import type { OpenCodeClient } from "@opencode/client/promise"
import { fetchSessionExport, sessionExportFilename } from "./export"

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions -- partial fixtures stand in for the client methods the export calls */

describe("sessionExportFilename", () => {
  test("shortens long titles to fit the filename limit", () => {
    expect(sessionExportFilename({ id: "ses_123", title: "a".repeat(300) })).toBe(`${"a".repeat(250)}.json`)
  })
})

describe("fetchSessionExport", () => {
  test("cancelling the export aborts every request it sent, on every page", async () => {
    const controller = new AbortController()
    const signals: AbortSignal[] = []

    const api = {
      session: {
        get: async (_input: { sessionID: string }, options: { signal: AbortSignal }) => {
          signals.push(options.signal)

          return { id: "ses_1" }
        },
      },
      message: {
        list: async (input: { cursor?: string }, options: { signal: AbortSignal }) => {
          signals.push(options.signal)

          return input.cursor ? { data: [], cursor: {} } : { data: [], cursor: { next: "page-2" } }
        },
      },
    } as unknown as Pick<OpenCodeClient, "session" | "message">

    await fetchSessionExport({ sessionID: "ses_1", api, signal: controller.signal })

    expect(signals.map((signal) => signal.aborted)).toEqual([false, false, false])
    controller.abort()
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true, true])
  })
})
