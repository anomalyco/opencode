import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { verifyHcaptcha } from "./hcaptcha"
import { handleEnterpriseRequest } from "./enterprise"

afterEach(() => mock.restore())

test("verifies a token with hCaptcha siteverify", async () => {
  const requests: Request[] = []
  const result = await verifyHcaptcha("token-123", {
    secret: "test-secret",
    remoteip: "203.0.113.7",
    fetch: async (request) => {
      requests.push(request)
      return Response.json({ success: true })
    },
  })

  expect(result).toBe(true)
  expect(requests[0].url).toBe("https://api.hcaptcha.com/siteverify")
  const body = new URLSearchParams(await requests[0].text())
  expect(body.get("secret")).toBe("test-secret")
  expect(body.get("response")).toBe("token-123")
  expect(body.get("remoteip")).toBe("203.0.113.7")
})

test("rejects tokens hCaptcha says are invalid", async () => {
  spyOn(console, "warn").mockImplementation(() => {})
  const result = await verifyHcaptcha("bad", {
    secret: "test-secret",
    fetch: async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }),
  })
  expect(result).toBe(false)
})

test("returns undefined when hCaptcha is unreachable or misconfigured", async () => {
  spyOn(console, "error").mockImplementation(() => {})
  const failures = [
    async () => new Response("down", { status: 503 }),
    async () => {
      throw new Error("network")
    },
    async () => Response.json({ success: false, "error-codes": ["invalid-input-secret"] }),
    (request: Request) =>
      new Promise<Response>((_, reject) =>
        request.signal.addEventListener("abort", () => reject(request.signal.reason)),
      ),
  ]
  for (const fetch of failures) {
    expect(await verifyHcaptcha("token", { secret: "test-secret", timeoutMs: 20, fetch })).toBeUndefined()
  }
})

const submit = async (captcha: string | undefined, verify: () => Promise<Response>) => {
  const leads: Record<string, unknown>[] = []
  const response = await handleEnterpriseRequest(
    new Request("http://localhost/api/enterprise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Fake Visitor",
        role: "Engineering lead",
        email: "fake-visitor@example.test",
        message: "We need SSO for 200 developers.",
        captcha,
      }),
    }),
    {
      captcha: { secret: "test-secret", fetch: verify },
      spam: { apiKey: "test-key", fetch: async () => new Response(null, { status: 503 }) },
      salesforceSubmit: async (payload) => {
        leads.push(payload)
        return true
      },
      notifications: false,
    },
  )
  return { status: response.status, leads }
}

test("the enterprise form rejects missing or invalid captcha tokens before creating a lead", async () => {
  spyOn(console, "warn").mockImplementation(() => {})
  const verified: string[] = []
  const missing = await submit(undefined, async () => {
    verified.push("called")
    return Response.json({ success: true })
  })
  expect(missing).toEqual({ status: 400, leads: [] })
  expect(verified).toHaveLength(0)

  const invalid = await submit("bad", async () => Response.json({ success: false }))
  expect(invalid).toEqual({ status: 400, leads: [] })
})

test("the enterprise form accepts verified tokens and fails open when hCaptcha is down", async () => {
  spyOn(console, "error").mockImplementation(() => {})
  expect((await submit("good", async () => Response.json({ success: true }))).leads).toHaveLength(1)
  expect((await submit("good", async () => new Response("down", { status: 503 }))).leads).toHaveLength(1)
})
