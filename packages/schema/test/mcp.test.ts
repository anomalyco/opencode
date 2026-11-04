import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Mcp } from "../src/mcp.js"

describe("Mcp resources", () => {
  test("decodes resource catalogs and omits absent metadata", () => {
    const value = Schema.decodeUnknownSync(Mcp.ResourceCatalog)({
      resources: [{ server: "docs", name: "Readme", uri: "docs://readme" }],
      templates: [{ server: "docs", name: "File", uriTemplate: "docs://{path}" }],
    })

    expect(Schema.encodeSync(Mcp.ResourceCatalog)(value)).toEqual({
      resources: [{ server: "docs", name: "Readme", uri: "docs://readme" }],
      templates: [{ server: "docs", name: "File", uriTemplate: "docs://{path}" }],
    })
  })

  test("preserves text and base64 blob contents", () => {
    expect(
      Schema.decodeUnknownSync(Mcp.ResourceContent)({
        server: "docs",
        uri: "docs://readme",
        contents: [
          { type: "text", uri: "docs://readme", text: "hello", mimeType: "text/plain" },
          { type: "blob", uri: "docs://logo", blob: "aGVsbG8=", mimeType: "image/png" },
        ],
      }),
    ).toEqual({
      server: "docs",
      uri: "docs://readme",
      contents: [
        { type: "text", uri: "docs://readme", text: "hello", mimeType: "text/plain" },
        { type: "blob", uri: "docs://logo", blob: "aGVsbG8=", mimeType: "image/png" },
      ],
    })
  })
})

describe("Mcp.normalizeUrl", () => {
  test.each([
    ["https://api.githubcopilot.com/mcp/", "https://api.githubcopilot.com/mcp"],
    ["HTTPS://API.GitHubCopilot.com:443/%6d%63%70?codemode=false#top", "https://api.githubcopilot.com/mcp"],
    ["https://mcp.vercel.com/", "https://mcp.vercel.com"],
    ["http://localhost:80/mcp", "http://localhost/mcp"],
    ["http://localhost:5000/", "http://localhost:5000"],
    ["https://mcp.example.com/mcp?apiKey=secret", "https://mcp.example.com/mcp"],
    ["https://mcp.example.com//v1///mcp//", "https://mcp.example.com/v1/mcp"],
    ["https://mcp.example.com/v1/../mcp", "https://mcp.example.com/mcp"],
    ["https://mcp.example.com/a%2fb%3f", "https://mcp.example.com/a%2Fb%3F"],
    ["  https://mcp.example.com/mcp  ", "https://mcp.example.com/mcp"],
  ])("%s", (raw, normalized) => {
    expect(Mcp.normalizeUrl(raw)).toBe(normalized)
  })

  test.each(["stdio:npx foo", "not a url", "ftp://mcp.example.com", "https://user:secret@mcp.example.com/mcp"])(
    "rejects %s",
    (raw) => {
      expect(Mcp.normalizeUrl(raw)).toBeUndefined()
    },
  )
})

describe("Mcp.matchUrl", () => {
  test("matches every server, including local ones, only with a bare wildcard", () => {
    expect(Mcp.matchUrl(undefined, "*")).toBe(true)
    expect(Mcp.matchUrl("https://mcp.example.com/mcp", "*")).toBe(true)
    expect(Mcp.matchUrl(undefined, "https://*")).toBe(false)
    expect(Mcp.matchUrl(undefined, "https://mcp.example.com/mcp")).toBe(false)
    expect(Mcp.matchUrl("https://mcp.example.com/mcp", "https://*")).toBe(true)
    expect(Mcp.matchUrl("http://mcp.example.com/mcp", "https://*")).toBe(false)
  })

  test("matches a literal path and the paths below it", () => {
    const pattern = "https://api.githubcopilot.com/mcp/"
    expect(Mcp.matchUrl("https://api.githubcopilot.com/mcp", pattern)).toBe(true)
    expect(Mcp.matchUrl("https://API.githubcopilot.com/mcp/?codemode=false", pattern)).toBe(true)
    expect(Mcp.matchUrl("https://api.githubcopilot.com/mcp/readonly", pattern)).toBe(true)
    expect(Mcp.matchUrl("https://api.githubcopilot.com/mcp-other", pattern)).toBe(false)
    expect(Mcp.matchUrl("https://api.githubcopilot.com", pattern)).toBe(false)
    expect(
      Mcp.matchUrl(
        "https://opencode.ai/console/api/integration-gateway/linear/mcp",
        "https://opencode.ai/console/api/integration-gateway/github/mcp",
      ),
    ).toBe(false)
  })

  test("matches a whole host when the pattern has no path", () => {
    const pattern = "https://mcp.vercel.com"
    expect(Mcp.matchUrl("https://mcp.vercel.com", pattern)).toBe(true)
    expect(Mcp.matchUrl("https://mcp.vercel.com/acme/web", pattern)).toBe(true)
    expect(Mcp.matchUrl("https://mcp.vercel.com.evil.com", pattern)).toBe(false)
    expect(Mcp.matchUrl("https://mcp.vercel.com:8443", pattern)).toBe(false)
  })

  test("keeps a host wildcard inside the host", () => {
    expect(Mcp.matchUrl("https://us5.datadoghq.com/v1/mcp", "https://*.datadoghq.com/v1/mcp")).toBe(true)
    expect(Mcp.matchUrl("https://evil.com/.datadoghq.com/v1/mcp", "https://*.datadoghq.com/v1/mcp")).toBe(false)
    expect(Mcp.matchUrl("https://logfire-eu.pydantic.dev/mcp", "https://logfire-*.pydantic.dev/mcp")).toBe(true)
    expect(Mcp.matchUrl("https://logfire-eu.pydantic.dev.evil.com/mcp", "https://logfire-*.pydantic.dev/mcp")).toBe(
      false,
    )
  })

  test("matches a path wildcard against the whole path", () => {
    const pattern = "https://mcp.example.com/*/mcp"
    expect(Mcp.matchUrl("https://mcp.example.com/acme/mcp", pattern)).toBe(true)
    expect(Mcp.matchUrl("https://mcp.example.com/acme/mcp/readonly", pattern)).toBe(false)
  })

  test("matches nothing for a pattern that is not an http(s) URL", () => {
    expect(Mcp.matchUrl("https://mcp.example.com/mcp", "github")).toBe(false)
    expect(Mcp.matchUrl("https://mcp.example.com/mcp", "https://user@mcp.example.com/mcp")).toBe(false)
  })
})
