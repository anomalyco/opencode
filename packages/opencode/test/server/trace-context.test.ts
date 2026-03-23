import { describe, expect, spyOn, test } from "bun:test"
import { context, trace } from "@opentelemetry/api"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("server trace context", () => {
  test("continues incoming trace context for request handlers", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({})
    const originalProvide = Instance.provide
    let seen:
      | {
          traceId: string | null
          spanId: string | null
          isRemote: boolean
        }
      | undefined
    const provideSpy = spyOn(Instance, "provide").mockImplementation(async (input) => {
      const spanContext = trace.getSpanContext(context.active())
      seen = {
        traceId: spanContext?.traceId ?? null,
        spanId: spanContext?.spanId ?? null,
        isRemote: spanContext?.isRemote ?? false,
      }
      return originalProvide(input)
    })

    try {
      const response = await app.request("/path", {
        headers: {
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          "x-opencode-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      expect(seen).toEqual({
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        isRemote: true,
      })
    } finally {
      provideSpy.mockRestore()
    }
  })

  test("leaves request handlers on root context when no trace headers are present", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({})
    const originalProvide = Instance.provide
    let seen:
      | {
          traceId: string | null
          spanId: string | null
          isRemote: boolean
        }
      | undefined
    const provideSpy = spyOn(Instance, "provide").mockImplementation(async (input) => {
      const spanContext = trace.getSpanContext(context.active())
      seen = {
        traceId: spanContext?.traceId ?? null,
        spanId: spanContext?.spanId ?? null,
        isRemote: spanContext?.isRemote ?? false,
      }
      return originalProvide(input)
    })

    try {
      const response = await app.request("/path", {
        headers: {
          "x-opencode-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      expect(seen).toEqual({
        traceId: null,
        spanId: null,
        isRemote: false,
      })
    } finally {
      provideSpy.mockRestore()
    }
  })
})
