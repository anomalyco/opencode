import { describe, expect, test } from "bun:test"
import type { Client } from "../src/v2/gen/client/index"
import { Session2 } from "../src/v2/gen/sdk.gen"

function createClient() {
  let request: Record<string, unknown> | undefined

  return {
    sdk: new Session2({
      client: {
        buildUrl() {
          return ""
        },
        getConfig() {
          return {}
        },
        request() {
          throw new Error("unused")
        },
        setConfig(config) {
          return config
        },
        post(options) {
          request = options as Record<string, unknown>
          return options
        },
      } as unknown as Client,
    }),
    getRequest() {
      return request
    },
  }
}

describe("Session.fork", () => {
  test("sends an empty JSON object for full-session forks", () => {
    const client = createClient()

    client.sdk.fork({ sessionID: "session_123" })

    expect(client.getRequest()?.body).toEqual({})
  })

  test("preserves messageID body for timeline forks", () => {
    const client = createClient()

    client.sdk.fork({ sessionID: "session_123", messageID: "message_123" })

    expect(client.getRequest()?.body).toEqual({ messageID: "message_123" })
  })
})
