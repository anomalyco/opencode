import { describe, expect, mock, test } from "bun:test"
import type { APIEvent } from "@solidjs/start/server"

// Every Zen route module imports the inference handler and the console resources, which resolve
// SST-backed bindings at import time. A preflight never reaches any of them, so the resource layer
// is stubbed out and the routes are imported dynamically to keep the test hermetic.
await mock.module("@opencode/console-resource", () => ({
  Resource: new Proxy({}, { get: () => ({ value: "stub" }) }),
  waitUntil: async () => {},
}))

const routes = {
  "/zen/v1/models": () => import("../src/routes/zen/v1/models"),
  "/zen/v1/models/{model}": () => import("../src/routes/zen/v1/models/[model]"),
  "/zen/v1/chat/completions": () => import("../src/routes/zen/v1/chat/completions"),
  "/zen/v1/messages": () => import("../src/routes/zen/v1/messages"),
  "/zen/v1/responses": () => import("../src/routes/zen/v1/responses"),
  "/zen/go/v1/models": () => import("../src/routes/zen/go/v1/models"),
  "/zen/go/v1/chat/completions": () => import("../src/routes/zen/go/v1/chat/completions"),
  "/zen/go/v1/messages": () => import("../src/routes/zen/go/v1/messages"),
  "/zen/go/v1/responses": () => import("../src/routes/zen/go/v1/responses"),
}

// The gateway sends the key either as a bearer token or as the provider-native key header, and it
// forwards the client's anthropic-version. A browser preflight is rejected unless all of them are
// allowed.
const allowedHeaders = ["Content-Type", "Authorization", "x-api-key", "x-goog-api-key", "anthropic-version"]

describe("Zen API CORS preflight", () => {
  for (const [path, load] of Object.entries(routes)) {
    test(`${path} answers OPTIONS with CORS headers`, async () => {
      const route = await load()
      const response = await route.OPTIONS({
        request: new Request(`https://opencode.ai${path}`, { method: "OPTIONS" }),
      } as APIEvent)

      expect(response.status).toBe(200)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST")

      const headers = response.headers.get("Access-Control-Allow-Headers") ?? ""
      for (const header of allowedHeaders) expect(headers).toContain(header)
    })
  }
})
