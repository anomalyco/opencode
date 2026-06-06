import { describe, expect, test, spyOn } from "bun:test"
import { AntigravityAuthPlugin } from "../../src/plugin/google-antigravity/antigravity"
import { expiryMs } from "../../src/plugin/google-antigravity/keychain"
import {
  catalog,
  translateRequest,
  unwrapJson,
  unwrapSse,
  PROVIDER_ID,
  CLOUDCODE_BASE,
} from "../../src/plugin/google-antigravity/models"
import { OAUTH_DUMMY_KEY } from "../../src/auth"

describe("plugin.google-antigravity", () => {
  describe("keychain.expiryMs", () => {
    test("correctly parses RFC3339 expiry string to milliseconds", () => {
      const token = {
        access_token: "access",
        refresh_token: "refresh",
        expiry: "2026-06-05T21:00:00Z",
        token_type: "Bearer",
      }
      expect(expiryMs(token)).toBe(new Date("2026-06-05T21:00:00Z").getTime())
    })
  })

  describe("models.catalog", () => {
    test("returns a static fallback catalog across providers", () => {
      const cat = catalog()
      expect(cat["gemini-3-flash"]).toBeDefined()
      expect(cat["gemini-3-flash"].providerID).toBe(PROVIDER_ID)
      expect(cat["gemini-3-flash"].family).toBe("gemini")
      // fallback spans all three upstream providers agy proxies
      expect(cat["claude-sonnet-4-6"].family).toBe("claude")
      expect(cat["gpt-oss-120b-medium"].family).toBe("gpt-oss")
    })
  })

  describe("models.translateRequest", () => {
    test("returns null for non-generate URLs", () => {
      expect(translateRequest("https://example.com/api/test", undefined, "my-proj")).toBeNull()
    })

    test("translates generateContent calls to cloudcode-pa v1internal envelope", () => {
      const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
      const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello" }] }] })
      const res = translateRequest(url, body, "my-proj")

      expect(res).not.toBeNull()
      expect(res!.url).toBe(`${CLOUDCODE_BASE}/v1internal:generateContent`)
      expect(res!.streaming).toBe(false)
      const parsedBody = JSON.parse(res!.body)
      expect(parsedBody.model).toBe("gemini-2.5-flash")
      expect(parsedBody.project).toBe("my-proj")
      expect(parsedBody.request.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }])
    })

    test("translates streamGenerateContent calls to cloudcode-pa v1internal envelope with sse query param", () => {
      const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:streamGenerateContent"
      const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "stream this" }] }] })
      const res = translateRequest(url, body, "my-proj")

      expect(res).not.toBeNull()
      expect(res!.url).toBe(`${CLOUDCODE_BASE}/v1internal:streamGenerateContent?alt=sse`)
      expect(res!.streaming).toBe(true)
      const parsedBody = JSON.parse(res!.body)
      expect(parsedBody.model).toBe("gemini-3-flash")
      expect(parsedBody.project).toBe("my-proj")
    })

    test("injects matched ids onto functionCall/functionResponse parts for Claude/GPT-OSS", () => {
      const url = "https://generativelanguage.googleapis.com/v1beta/models/claude-sonnet-4-6:generateContent"
      const body = JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: "weather in Paris and Tokyo?" }] },
          { role: "model", parts: [{ functionCall: { name: "wx", args: { c: "Paris" } } }, { functionCall: { name: "wx", args: { c: "Tokyo" } } }] },
          { role: "user", parts: [{ functionResponse: { name: "wx", response: { v: "20C" } } }, { functionResponse: { name: "wx", response: { v: "14C" } } }] },
        ],
      })
      const contents = JSON.parse(translateRequest(url, body, "p")!.body).request.contents
      const callIds = contents[1].parts.map((p: any) => p.functionCall.id)
      const respIds = contents[2].parts.map((p: any) => p.functionResponse.id)
      // every part gets an id, and parallel calls pair to their responses in order
      expect(callIds.every(Boolean)).toBe(true)
      expect(callIds).toEqual(respIds)
      expect(new Set(callIds).size).toBe(2) // distinct ids for distinct calls
    })

    test("preserves an id already present on a functionCall", () => {
      const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent"
      const body = JSON.stringify({
        contents: [{ role: "model", parts: [{ functionCall: { name: "wx", id: "native-xyz", args: {} } }] }],
      })
      const contents = JSON.parse(translateRequest(url, body, "p")!.body).request.contents
      expect(contents[0].parts[0].functionCall.id).toBe("native-xyz")
    })
  })

  describe("models.unwrapJson", () => {
    test("unwraps the response wrapper from cloudcode json responses", async () => {
      const wrappedResponse = new Response(JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "hi" }] } }] } }))
      const unwrapped = await unwrapJson(wrappedResponse)
      const data = await unwrapped.json()
      expect(data).toEqual({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })
    })

    test("returns original json if response field is not present", async () => {
      const plainResponse = new Response(JSON.stringify({ other: "data" }))
      const unwrapped = await unwrapJson(plainResponse)
      const data = await unwrapped.json()
      expect(data).toEqual({ other: "data" })
    })
  })

  describe("models.unwrapSse", () => {
    test("transforms SSE lines to unwrap the response payload", async () => {
      const mockStream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('data: {"response": {"candidates": [{"content": {"parts": [{"text": "hello"}]}}]}}\n\n'))
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        }
      })
      const wrappedResponse = new Response(mockStream)
      const unwrapped = unwrapSse(wrappedResponse)
      const reader = unwrapped.body!.getReader()
      const decoder = new TextDecoder()

      let text = ""
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        text += decoder.decode(value)
      }

      expect(text).toContain('data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}')
      expect(text).toContain("data: [DONE]")
    })
  })

  describe("AntigravityAuthPlugin", () => {
    test("loader returns empty object if stored credentials are not oauth", async () => {
      const hooks = await AntigravityAuthPlugin({} as any)
      const getAuthApi = async () => ({ type: "api" as const, key: "my-key" })
      const loaderRes = await hooks.auth!.loader!(getAuthApi, {} as any)
      expect(loaderRes).toEqual({})
    })

    test("loader proxies requests and rewrites generateContent calls", async () => {
      const hooks = await AntigravityAuthPlugin({} as any)
      const getAuthOauth = async () => ({
        type: "oauth" as const,
        access: "my-access-token",
        refresh: "my-refresh-token",
        expires: Date.now() + 3600_000,
      })

      // Spy on global fetch
      const fetchSpy = spyOn(global, "fetch").mockImplementation(async (request, init) => {
        const urlStr = request instanceof URL ? request.href : typeof request === "string" ? request : request.url
        if (urlStr.includes("loadCodeAssist")) {
          return new Response(JSON.stringify({ cloudaicompanionProject: "my-proj" }))
        }
        if (urlStr.includes("generateContent")) {
          // Verify request envelope was wrapped
          const body = JSON.parse(init?.body as string)
          expect(body.project).toBe("my-proj")
          expect(body.model).toBe("gemini-2.5-flash")
          return new Response(JSON.stringify({ response: { text: "mocked reply" } }))
        }
        return new Response("not found", { status: 404 })
      })

      try {
        const loaderRes = await hooks.auth!.loader!(getAuthOauth, {} as any)
        expect(loaderRes.fetch).toBeDefined()

        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
        const response = await loaderRes.fetch!(url, {
          method: "POST",
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
        })

        expect(response.status).toBe(200)
        const json = await response.json()
        expect(json).toEqual({ text: "mocked reply" })
        expect(fetchSpy).toHaveBeenCalledTimes(2) // loadCodeAssist + generateContent
      } finally {
        fetchSpy.mockRestore()
      }
    })
  })
})
