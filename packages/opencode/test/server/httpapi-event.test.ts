import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { Event as ServerEvent } from "../../src/server/event"
import * as Log from "@opencode-ai/core/util/log"
import { Schema } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, reloadTestInstance, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

const EventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
})

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("timed out waiting for event")), 5_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function readFirstEvent(response: Response) {
  if (!response.body) throw new Error("missing response body")
  const reader = response.body.getReader()
  try {
    return await readEvent(reader)
  } finally {
    await reader.cancel()
  }
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await readChunk(reader)
  if (result.done || !result.value) throw new Error("event stream closed")
  return Schema.decodeUnknownSync(EventData)(JSON.parse(new TextDecoder().decode(result.value).replace(/^data: /, "")))
}

async function readStatusWithin(reader: ReadableStreamDefaultReader<Uint8Array>, delay: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read().then((result) => (result.done ? "closed" : "event")),
      new Promise<"open">((resolve) => {
        timeout = setTimeout(() => resolve("open"), delay)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("event HttpApi", () => {
  test("serves event stream", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform")
    expect(response.headers.get("x-accel-buffering")).toBe("no")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await readFirstEvent(response)).toMatchObject({ type: "server.connected", properties: {} })
  })

  test("keeps the event stream open after the initial event", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")

    const reader = response.body.getReader()
    try {
      expect(await readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })
      expect(await readStatusWithin(reader, 250)).toBe("open")
    } finally {
      await reader.cancel()
    }
  })

  test("delivers instance bus events after the initial event", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")

    const reader = response.body.getReader()
    try {
      expect(await readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

      const next = readEvent(reader)
      const ctx = await reloadTestInstance({ directory: tmp.path })
      await Instance.restore(ctx, () => Bus.publish(ServerEvent.Connected, {}))

      expect(await next).toMatchObject({ type: "server.connected", properties: {} })
    } finally {
      await reader.cancel()
    }
  })
})
