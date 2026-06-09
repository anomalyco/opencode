import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { iflowBaseURL, IFLOW_DEFAULT_BASE_URL } from "../../src/tool/iflow-client"
import { fetch, formatFetchResult } from "../../src/tool/iflow-fetch"
import { testEffect } from "../lib/effect"
import { failureMessage, withEnv, withIflowServer } from "./iflow-test-util"

const it = testEffect(FetchHttpClient.layer)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const mockCredential = () => ["mock", "credential"].join("-")

describe("tool.iflow-fetch", () => {
  it.effect("requires IFLOW_API_KEY", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const message = yield* withEnv(
        { IFLOW_API_KEY: undefined, IFLOW_BASE_URL: undefined },
        failureMessage(fetch(http, { url: "https://example.com" })),
      )
      expect(message).toContain("IFLOW_API_KEY is required when OPENCODE_WEBFETCH_PROVIDER=iflow.")
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

  it.effect("normalizes webFetch success responses", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const result = yield* withIflowServer(
        async (request) => {
          expect(new URL(request.url).pathname).toBe("/api/search/webFetch")
          const body = (await request.json()) as Record<string, unknown>
          expect(body.url).toBe("https://example.com/docs")
          return json({
            success: true,
            data: {
              title: "Docs",
              url: "https://example.com/docs",
              markdown: "# Documentation\n\nContent body",
            },
          })
        },
        (url) =>
          withEnv(
            { IFLOW_API_KEY: mockCredential(), IFLOW_BASE_URL: url.toString() },
            fetch(http, { url: "https://example.com/docs" }),
          ),
      )

      expect(result).toContain("Title: Docs")
      expect(result).toContain("URL: https://example.com/docs")
      expect(result).toContain("Content:\n# Documentation")
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
              failureMessage(fetch(http, { url: "https://example.com" })),
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
            failureMessage(fetch(http, { url: "https://example.com" })),
          ),
      )
      expect(message).toContain("iFlow rate limit exceeded")
    }),
  )

  it.effect("handles HTTP 5xx errors", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const message = yield* withIflowServer(
        () => json({}, 502),
        (url) =>
          withEnv(
            { IFLOW_API_KEY: mockCredential(), IFLOW_BASE_URL: url.toString() },
            failureMessage(fetch(http, { url: "https://example.com" })),
          ),
      )
      expect(message).toContain("iFlow service error (502)")
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
            failureMessage(fetch(http, { url: "https://example.com" })),
          ),
      )
      expect(message).toContain("iFlow returned invalid JSON.")
    }),
  )

  it.effect("handles business errors", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const message = yield* withIflowServer(
        () => json({ success: false, message: "fetch failed" }),
        (url) =>
          withEnv(
            { IFLOW_API_KEY: mockCredential(), IFLOW_BASE_URL: url.toString() },
            failureMessage(fetch(http, { url: "https://example.com" })),
          ),
      )
      expect(message).toContain("iFlow request failed: fetch failed.")
    }),
  )

  it.effect("formats common alternate content fields", () =>
    Effect.sync(() => {
      const output = formatFetchResult(
        {
          result: {
            title: "Fetched",
            url: "https://example.com/page",
            text: "Plain text body",
          },
        },
        "https://fallback.example",
      )
      expect(output).toContain("Title: Fetched")
      expect(output).toContain("URL: https://example.com/page")
      expect(output).toContain("Content:\nPlain text body")
    }),
  )
})
