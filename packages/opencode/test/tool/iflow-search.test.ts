import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { iflowBaseURL, IFLOW_DEFAULT_BASE_URL } from "../../src/tool/iflow-client"
import { formatSearchResults, normalizeCount, search } from "../../src/tool/iflow-search"
import { testEffect } from "../lib/effect"
import { failureMessage, withEnv, withIflowServer } from "./iflow-test-util"

const it = testEffect(FetchHttpClient.layer)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const mockCredential = () => ["mock", "credential"].join("-")

describe("tool.iflow-search", () => {
  it.effect("requires IFLOW_API_KEY", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const message = yield* withEnv(
        { IFLOW_API_KEY: undefined, IFLOW_BASE_URL: undefined },
        failureMessage(search(http, { query: "missing key" })),
      )
      expect(message).toContain("IFLOW_API_KEY is required when OPENCODE_WEBSEARCH_PROVIDER=iflow.")
    }),
  )

  it.effect("uses the default base URL", () =>
    Effect.sync(() => {
      const original = process.env.IFLOW_BASE_URL
      delete process.env.IFLOW_BASE_URL
      try {
        expect(iflowBaseURL()).toBe(IFLOW_DEFAULT_BASE_URL)
      } finally {
        if (original === undefined) delete process.env.IFLOW_BASE_URL
        else process.env.IFLOW_BASE_URL = original
      }
    }),
  )

  it.effect("normalizes trailing slashes from IFLOW_BASE_URL", () =>
    Effect.sync(() => {
      const original = process.env.IFLOW_BASE_URL
      process.env.IFLOW_BASE_URL = "https://platform.iflow.cn///"
      try {
        expect(iflowBaseURL()).toBe(IFLOW_DEFAULT_BASE_URL)
      } finally {
        if (original === undefined) delete process.env.IFLOW_BASE_URL
        else process.env.IFLOW_BASE_URL = original
      }
    }),
  )

  it.effect("normalizes success responses into string output", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const result = yield* withIflowServer(
        async (request) => {
          expect(new URL(request.url).pathname).toBe("/api/search/webSearch")
          const body = (await request.json()) as Record<string, unknown>
          expect(body.keywords).toBe("opencode iflow")
          expect(body.num).toBe(3)
          return json({
            success: true,
            data: {
              organic: [
                {
                  title: "OpenCode iFlow",
                  link: "https://example.com/opencode",
                  snippet: "Search result summary",
                  published_time: "2026-06-09",
                  source: "example",
                },
              ],
            },
          })
        },
        (url) =>
          withEnv(
            { IFLOW_API_KEY: mockCredential(), IFLOW_BASE_URL: url.toString() },
            search(http, { query: "opencode iflow", count: 3 }),
          ),
      )

      expect(result).toContain("1. OpenCode iFlow")
      expect(result).toContain("URL: https://example.com/opencode")
      expect(result).toContain("Snippet: Search result summary")
      expect(result).toContain("Published: 2026-06-09")
      expect(result).toContain("Source: example")
    }),
  )

  it.effect("handles HTTP 401 and 403 errors", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      for (const status of [401, 403]) {
        const message = yield* withIflowServer(
          () => json({ success: false }, status),
          (url) =>
            withEnv(
              { IFLOW_API_KEY: mockCredential(), IFLOW_BASE_URL: url.toString() },
              failureMessage(search(http, { query: "auth" })),
            ),
        )
        expect(message).toContain("iFlow request was not authorized")
      }
    }),
  )

  it.effect("handles HTTP 429 errors", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const message = yield* withIflowServer(
        () => json({}, 429),
        (url) =>
          withEnv(
            { IFLOW_API_KEY: mockCredential(), IFLOW_BASE_URL: url.toString() },
            failureMessage(search(http, { query: "rate" })),
          ),
      )
      expect(message).toContain("iFlow rate limit exceeded")
    }),
  )

  it.effect("handles HTTP 5xx errors", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const message = yield* withIflowServer(
        () => json({}, 503),
        (url) =>
          withEnv(
            { IFLOW_API_KEY: mockCredential(), IFLOW_BASE_URL: url.toString() },
            failureMessage(search(http, { query: "server" })),
          ),
      )
      expect(message).toContain("iFlow service error (503)")
    }),
  )

  it.effect("handles bad JSON errors", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const message = yield* withIflowServer(
        () => new Response("{", { status: 200 }),
        (url) =>
          withEnv(
            { IFLOW_API_KEY: mockCredential(), IFLOW_BASE_URL: url.toString() },
            failureMessage(search(http, { query: "json" })),
          ),
      )
      expect(message).toContain("iFlow returned invalid JSON.")
    }),
  )

  it.effect("handles business errors", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const message = yield* withIflowServer(
        () => json({ success: false, message: "quota unavailable" }),
        (url) =>
          withEnv(
            { IFLOW_API_KEY: mockCredential(), IFLOW_BASE_URL: url.toString() },
            failureMessage(search(http, { query: "business" })),
          ),
      )
      expect(message).toContain("iFlow request failed: quota unavailable.")
    }),
  )

  it.effect("normalizes count limits", () =>
    Effect.sync(() => {
      expect(normalizeCount(0)).toBeUndefined()
      expect(normalizeCount(3.8)).toBe(3)
      expect(normalizeCount(100)).toBe(20)
    }),
  )

  it.effect("formats common alternate result fields", () =>
    Effect.sync(() => {
      const output = formatSearchResults({
        results: [{ title: "Title", link: "https://example.com", content: "Content", source: "Source" }],
      })
      expect(output).toContain("1. Title")
      expect(output).toContain("URL: https://example.com")
      expect(output).toContain("Snippet: Content")
    }),
  )
})
