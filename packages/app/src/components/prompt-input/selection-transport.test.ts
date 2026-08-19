import { describe, expect, test } from "bun:test"
import { ClientError } from "@opencode-ai/client/promise"
import { createApiForServer } from "@/utils/server"
import { createCompatibleApi } from "@/utils/server-compat"

function setup(protocol: "v1" | "v2", promptResponse?: () => Response) {
  const requests: Request[] = []
  const legacyInputs: unknown[] = []
  const fetcher = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.url.endsWith("/prompt_async")) return new Response(undefined, { status: 204 })
      if (request.url.endsWith("/prompt")) {
        if (promptResponse) return promptResponse()
        return Response.json({
          data: {
            admittedSeq: 1,
            id: "msg_1",
            sessionID: "ses_1",
            timeCreated: 1,
            prompt: { text: "hello" },
            delivery: "steer",
          },
        })
      }
      return new Response(undefined, { status: 204 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const server = { url: "http://localhost:4096" }
  const api = createCompatibleApi({
    protocol: Promise.resolve(protocol),
    current: createApiForServer({ server, fetch: fetcher }),
    legacy: (() => ({
      session: { promptAsync: async (input: unknown) => legacyInputs.push(input) },
    })) as unknown as Parameters<typeof createCompatibleApi>[0]["legacy"],
    directory: "/repo",
  })
  const send = async (variant?: string) => {
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "hello",
      selection: {
        agent: "build",
        model: { providerID: "anthropic", id: "sonnet", variant },
      },
      agent: "build",
      model: { providerID: "anthropic", modelID: "sonnet" },
      variant,
    })
  }
  return { legacyInputs, requests, send }
}

describe("follow-up selection transport", () => {
  test("admits V2 selection atomically with the prompt", async () => {
    const fixture = setup("v2")

    await fixture.send("high")

    expect(fixture.requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/session/ses_1/prompt"])
    expect(await fixture.requests[0]!.json()).toMatchObject({
      prompt: { text: "hello" },
      selection: {
        agent: "build",
        model: { providerID: "anthropic", id: "sonnet", variant: "high" },
      },
    })
  })

  test("forwards V1 selection through the legacy prompt fields", async () => {
    const fixture = setup("v1")

    await fixture.send("high")

    expect(fixture.requests).toEqual([])
    expect(fixture.legacyInputs[0]).toMatchObject({
      agent: "build",
      model: { providerID: "anthropic", modelID: "sonnet" },
      variant: "high",
    })
  })

  test("rejects unsupported current-protocol error content", async () => {
    const fixture = setup("v2", () => new Response("unauthorized", { status: 401 }))

    const error = await fixture.send().catch((error) => error)

    expect(error).toBeInstanceOf(ClientError)
    expect(error.reason).toBe("UnsupportedContentType")
  })

  test("rejects malformed current-protocol success JSON", async () => {
    const fixture = setup(
      "v2",
      () => new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
    )

    const error = await fixture.send().catch((error) => error)

    expect(error).toBeInstanceOf(ClientError)
    expect(error.reason).toBe("MalformedResponse")
  })

  test("wraps current-protocol response read failures", async () => {
    const fixture = setup("v2", () => {
      const response = Response.json({ data: {} })
      Object.defineProperty(response, "text", { value: () => Promise.reject(new Error("read failed")) })
      return response
    })

    const error = await fixture.send().catch((error) => error)

    expect(error).toBeInstanceOf(ClientError)
    expect(error.reason).toBe("Transport")
  })
})
