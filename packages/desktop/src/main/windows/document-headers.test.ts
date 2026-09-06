import { expect, test } from "bun:test"
import { addDocumentHeaders } from "./document-headers"

test("protects packaged renderer documents", () => {
  const response = addDocumentHeaders(new Response("app"), "/renderer/index.html")

  expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(response.headers.get("content-security-policy")).toContain("object-src 'none'")
  expect(response.headers.get("content-security-policy")).toContain("base-uri 'none'")
  expect(response.headers.get("document-policy")).toBe("include-js-call-stacks-in-crash-reports")
})

test("leaves renderer assets unchanged", () => {
  const response = new Response("script")
  expect(addDocumentHeaders(response, "/renderer/app.js")).toBe(response)
})
