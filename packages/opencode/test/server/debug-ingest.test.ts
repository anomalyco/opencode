import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function logPath(worktreeRoot: string) {
  return path.join(worktreeRoot, ".opencode", "debug.log")
}

describe("debug.ingest endpoint", () => {
  test("accepts application/json single entry and appends one line", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreeRoot = tmp.path
    const sessionId = "ses_ingest_json_1"

    await Instance.provide({
      directory: worktreeRoot,
      fn: async () => {
        const app = Server.App()
        const entry = {
          timestamp: Date.now(),
          location: "file.ts:1",
          message: "hello",
          data: { a: 1 },
          sessionId,
          runId: "run1",
          hypothesisId: "A",
        }

        const response = await app.request(`/ingest/${sessionId}?directory=${encodeURIComponent(worktreeRoot)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(entry),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ success: true, count: 1 })

        const file = await fs.readFile(logPath(worktreeRoot), "utf8")
        const lines = file
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
        expect(lines.length).toBe(1)
        expect(JSON.parse(lines[0]!)).toEqual(entry)
      },
    })
  })

  test("accepts application/json array and appends all entries", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreeRoot = tmp.path
    const sessionId = "ses_ingest_json_array_1"

    await Instance.provide({
      directory: worktreeRoot,
      fn: async () => {
        const app = Server.App()
        const entry1 = {
          timestamp: Date.now(),
          location: "a.ts:1",
          message: "one",
          data: { n: 1 },
          sessionId,
          runId: "run1",
          hypothesisId: "A",
        }
        const entry2 = {
          timestamp: Date.now(),
          location: "b.ts:2",
          message: "two",
          data: { n: 2 },
          sessionId,
          runId: "run1",
          hypothesisId: "B",
        }

        const response = await app.request(`/ingest/${sessionId}?directory=${encodeURIComponent(worktreeRoot)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify([entry1, entry2]),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ success: true, count: 2 })

        const file = await fs.readFile(logPath(worktreeRoot), "utf8")
        const lines = file
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
        expect(lines.length).toBe(2)
        expect(JSON.parse(lines[0]!)).toEqual(entry1)
        expect(JSON.parse(lines[1]!)).toEqual(entry2)
      },
    })
  })

  test("accepts NDJSON and appends all entries", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreeRoot = tmp.path
    const sessionId = "ses_ingest_ndjson_1"

    await Instance.provide({
      directory: worktreeRoot,
      fn: async () => {
        const app = Server.App()
        const entry1 = {
          timestamp: Date.now(),
          location: "a.ts:1",
          message: "one",
          data: { n: 1 },
          sessionId,
          runId: "run1",
          hypothesisId: "A",
        }
        const entry2 = {
          timestamp: Date.now(),
          location: "b.ts:2",
          message: "two",
          data: { n: 2 },
          sessionId,
          runId: "run1",
          hypothesisId: "B",
        }
        const ndjson = [JSON.stringify(entry1), "", JSON.stringify(entry2), ""].join("\n")

        const response = await app.request(`/ingest/${sessionId}?directory=${encodeURIComponent(worktreeRoot)}`, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
          },
          body: ndjson,
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ success: true, count: 2 })

        const file = await fs.readFile(logPath(worktreeRoot), "utf8")
        const lines = file
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
        expect(lines.length).toBe(2)
        expect(JSON.parse(lines[0]!)).toEqual(entry1)
        expect(JSON.parse(lines[1]!)).toEqual(entry2)
      },
    })
  })

  test("rejects invalid entries with 400", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreeRoot = tmp.path
    const sessionId = "ses_ingest_invalid_1"

    await Instance.provide({
      directory: worktreeRoot,
      fn: async () => {
        const app = Server.App()
        const invalid = {
          // timestamp missing
          location: "file.ts:1",
          message: "bad",
          data: { a: 1 },
          sessionId,
          runId: "run1",
          hypothesisId: "A",
        }

        const response = await app.request(`/ingest/${sessionId}?directory=${encodeURIComponent(worktreeRoot)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalid),
        })
        expect(response.status).toBe(400)

        const fileExists = await fs
          .stat(logPath(worktreeRoot))
          .then(() => true)
          .catch(() => false)
        expect(fileExists).toBe(false)
      },
    })
  })

  test("rejects when body sessionId does not match /ingest/:sessionId", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreeRoot = tmp.path
    const pathSessionId = "ses_ingest_path_1"
    const bodySessionId = "ses_ingest_body_2"

    await Instance.provide({
      directory: worktreeRoot,
      fn: async () => {
        const app = Server.App()
        const entry = {
          timestamp: Date.now(),
          location: "file.ts:1",
          message: "mismatch",
          data: {},
          sessionId: bodySessionId,
          runId: "run1",
          hypothesisId: "A",
        }

        const response = await app.request(`/ingest/${pathSessionId}?directory=${encodeURIComponent(worktreeRoot)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(entry),
        })
        expect(response.status).toBe(400)
      },
    })
  })
})
