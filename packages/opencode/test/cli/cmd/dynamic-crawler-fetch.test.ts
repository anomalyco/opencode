import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { fetchPage, validateMarkdownSize } from "../../../src/cli/cmd/dynamic-crawler"

// Local test server
let server: ReturnType<typeof Bun.serve> | undefined
let baseUrl: string

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/ok") {
        return new Response("<html><body>Hello World</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
      }
      if (url.pathname === "/not-found") {
        return new Response("Not Found", { status: 404 })
      }
      if (url.pathname === "/empty") {
        return new Response("", { status: 200 })
      }
      return new Response("Not Found", { status: 404 })
    },
  })
  baseUrl = `http://localhost:${server.port}`
})

afterAll(() => {
  server?.stop(true)
})

describe("dynamic-crawler.fetchPage", () => {
  it("fetches a page successfully", async () => {
    const result = await fetchPage(`${baseUrl}/ok`, { timeout: 10000 })
    expect(result.status).toBe(200)
    expect(result.html).toContain("Hello World")
    expect(result.error).toBeUndefined()
  })

  it("handles non-200 status codes", async () => {
    const result = await fetchPage(`${baseUrl}/not-found`, { timeout: 10000 })
    expect(result.status).toBe(404)
  })

  it("handles empty content", async () => {
    const result = await fetchPage(`${baseUrl}/empty`, { timeout: 10000 })
    expect(result.html).toBe("")
  })
})

describe("dynamic-crawler.validateMarkdownSize", () => {
  it("returns content as-is if under 5KB", () => {
    const content = "Hello World"
    const result = validateMarkdownSize(content)
    expect(result.truncated).toBe(false)
    expect(result.content).toBe(content)
  })

  it("truncates content over 5KB at paragraph boundary", () => {
    const content = "A".repeat(6000)
    const result = validateMarkdownSize(content)
    expect(result.truncated).toBe(true)
    expect(result.content.length).toBeLessThanOrEqual(5200)
    expect(result.content).toContain("[Content truncated at 5KB]")
  })
})
