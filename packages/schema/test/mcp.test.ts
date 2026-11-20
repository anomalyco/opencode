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

  test("decodes remote TLS trust config and omits unset fields on encode", () => {
    const decoded = Schema.decodeUnknownSync(Mcp.RemoteConfig)({
      type: "remote",
      url: "https://192.168.1.1/mcp",
      tls: { ca_file: "~/.config/mcp/ca.pem", fingerprint: "SHA256:AA:BB" },
    })
    expect(Schema.encodeSync(Mcp.RemoteConfig)(decoded)).toEqual({
      type: "remote",
      url: "https://192.168.1.1/mcp",
      tls: { ca_file: "~/.config/mcp/ca.pem", fingerprint: "SHA256:AA:BB" },
    })
    const bare = Schema.decodeUnknownSync(Mcp.RemoteConfig)({ type: "remote", url: "https://example.com/mcp" })
    expect(Schema.encodeSync(Mcp.RemoteConfig)(bare)).toEqual({ type: "remote", url: "https://example.com/mcp" })
  })

  test("rejects non-string TLS trust fields", () => {
    expect(() =>
      Schema.decodeUnknownSync(Mcp.RemoteConfig)({ type: "remote", url: "https://example.com/mcp", tls: { ca_pem: 1 } }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Mcp.RemoteConfig)({ type: "remote", url: "https://example.com/mcp", tls: "pin" }),
    ).toThrow()
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
