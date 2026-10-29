import { createHash } from "node:crypto"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir as osTmpdir } from "node:os"
import path from "node:path"
import type { PeerCertificate } from "node:tls"
import { Buffer } from "node:buffer"
import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { McpClient } from "@opencode/core/mcp/client"
import { McpTls } from "@opencode/core/mcp/tls"
import { hostEnvironmentLayer } from "./fixture/environment"
import { CERT, CERT_APPLIANCE, KEY_APPLIANCE, startTlsMcpServer, TLS_FIXTURE_DIR } from "./fixture/tls-server"

const SAMPLE_CERT = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJALRNRw0Gx+9FMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjBF
MQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50
ZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB
CgKCAQEA0Z3VS5JJcV8xQKNl8N3t9X5N0JF7J8L8HKt1qE4fG2mO5PqR7sTuVwXy
Z1aBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTjKvWxVyZaBcDeF
gHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmN
oPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqN
vWxVyZaBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqNvWxVyZaB
cDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjI
QIDAQABMA0GCSqGSIb3DQEBCwUAA4IBAQBoJmO5PqR7sTuVwXyZ1aBcDeFgHjIkL
mNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsT
qNvWxVyZaBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqNvWxVyZ
aBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqNXv
-----END CERTIFICATE-----
`

// readCaFile trims trailing whitespace, so match against the trimmed cert.
const SAMPLE_CERT_TRIMMED = SAMPLE_CERT.trim()

function tmpdir(): { path: string; [Symbol.dispose](): void } {
  const dir = realpathSync(mkdtempSync(path.join(osTmpdir(), "opencode-test-tls-")))
  return {
    path: dir,
    [Symbol.dispose]() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function writeTempFile(dir: string, name: string, content: string) {
  const filePath = path.join(dir, name)
  writeFileSync(filePath, content)
  return filePath
}

describe("validatePemCert", () => {
  test("accepts a valid PEM certificate", () => {
    expect(() => McpTls.validatePemCert(SAMPLE_CERT, "test")).not.toThrow()
  })

  test("accepts a CA bundle with multiple certificates", () => {
    expect(() => McpTls.validatePemCert(`${SAMPLE_CERT}\n${SAMPLE_CERT}`, "test")).not.toThrow()
  })

  test("rejects content without BEGIN marker", () => {
    expect(() => McpTls.validatePemCert("just some text", "test")).toThrow("missing PEM certificate header")
  })

  test("rejects content with BEGIN but no END marker", () => {
    expect(() => McpTls.validatePemCert("-----BEGIN CERTIFICATE-----\nbase64data", "test")).toThrow(
      "missing PEM certificate footer",
    )
  })

  test("rejects content with empty body between markers", () => {
    expect(() => McpTls.validatePemCert("-----BEGIN CERTIFICATE-----\n\n-----END CERTIFICATE-----", "test")).toThrow(
      "empty PEM certificate body",
    )
  })

  test("rejects partial markers", () => {
    expect(() => McpTls.validatePemCert("-----BEGIN CERT-----not real-----END CERT-----", "test")).toThrow(
      "missing PEM certificate header",
    )
  })

  test("includes the source name in error messages", () => {
    expect(() => McpTls.validatePemCert("bad content", "ca_pem config entry")).toThrow("ca_pem config entry")
  })
})

describe("validateFingerprint", () => {
  test("accepts bare hex fingerprint", () => {
    expect(McpTls.validateFingerprint("a".repeat(64))).toBe("a".repeat(64))
  })

  test("accepts colon-separated fingerprint", () => {
    const result = McpTls.validateFingerprint(
      "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
    )
    expect(result).toHaveLength(64)
    expect(result).not.toContain(":")
  })

  test("accepts SHA256: prefixed fingerprint with or without colons", () => {
    expect(McpTls.validateFingerprint("SHA256:" + "a".repeat(64))).toBe("a".repeat(64))
    expect(
      McpTls.validateFingerprint(
        "SHA256:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      ),
    ).toHaveLength(64)
  })

  test("lowercases and trims", () => {
    const result = McpTls.validateFingerprint(
      "  AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99  ",
    )
    expect(result).toBe(result.toLowerCase())
    expect(result).toHaveLength(64)
  })

  test("rejects invalid values", () => {
    expect(() => McpTls.validateFingerprint("")).toThrow("Invalid SHA256 fingerprint")
    expect(() => McpTls.validateFingerprint("a".repeat(63))).toThrow("Invalid SHA256 fingerprint")
    expect(() => McpTls.validateFingerprint("a".repeat(65))).toThrow("Invalid SHA256 fingerprint")
    expect(() => McpTls.validateFingerprint("g" + "a".repeat(63))).toThrow("Invalid SHA256 fingerprint")
    expect(() => McpTls.validateFingerprint("SHA1:" + "a".repeat(64))).toThrow("Invalid SHA256 fingerprint")
    expect(() => McpTls.validateFingerprint("' OR '1'='1")).toThrow("Invalid SHA256 fingerprint")
  })
})

describe("resolveFilePath", () => {
  test("expands ~ to home directory", () => {
    const result = McpTls.resolveFilePath("~/test/file.pem", "/workspace")
    expect(result).not.toContain("~")
    expect(result).toContain("test")
  })

  test("returns absolute paths as-is", () => {
    expect(McpTls.resolveFilePath("/absolute/path/ca.pem", "/workspace")).toBe("/absolute/path/ca.pem")
  })

  test("resolves relative paths against workspace", () => {
    expect(McpTls.resolveFilePath("certs/ca.pem", "/workspace")).toBe(path.resolve("/workspace", "certs/ca.pem"))
  })
})

describe("readCaFile", () => {
  test("reads a valid PEM file", () => {
    using dir = tmpdir()
    const content = McpTls.readCaFile(writeTempFile(dir.path, "ca.pem", SAMPLE_CERT), dir.path)
    expect(content).toBe(SAMPLE_CERT_TRIMMED)
  })

  test("resolves relative paths against workspace", () => {
    using dir = tmpdir()
    writeTempFile(dir.path, "ca.pem", SAMPLE_CERT)
    expect(McpTls.readCaFile("ca.pem", dir.path)).toBe(SAMPLE_CERT_TRIMMED)
  })

  test("throws if file does not exist", () => {
    expect(() => McpTls.readCaFile("nonexistent.pem", "/workspace")).toThrow("CA file not found")
  })

  test("throws if path is a directory", () => {
    using dir = tmpdir()
    expect(() => McpTls.readCaFile(dir.path, dir.path)).toThrow("CA path is not a file")
  })

  test("throws if file does not contain a PEM certificate", () => {
    using dir = tmpdir()
    expect(() => McpTls.readCaFile(writeTempFile(dir.path, "bad.pem", "not a certificate"), dir.path)).toThrow(
      "missing PEM certificate header",
    )
  })

  test("includes the original path in error messages", () => {
    expect(() => McpTls.readCaFile("nonexistent.pem", "/workspace")).toThrow("nonexistent.pem")
  })
})

describe("derToPem", () => {
  test("converts DER bytes to PEM format", () => {
    const pem = McpTls.derToPem(new TextEncoder().encode("dummy-cert-bytes").buffer)
    expect(pem).toStartWith("-----BEGIN CERTIFICATE-----")
    expect(pem).toEndWith("-----END CERTIFICATE-----\n")
  })

  test("wraps base64 at 64 characters", () => {
    const pem = McpTls.derToPem(Uint8Array.from({ length: 256 }, (_, i) => i).buffer)
    for (const line of pem.split("\n").slice(1, -2)) expect(line).toMatch(/^[A-Za-z0-9+/=]{1,64}$/)
  })

  test("empty DER produces minimal PEM", () => {
    expect(McpTls.derToPem(new ArrayBuffer(0))).toBe("-----BEGIN CERTIFICATE-----\n\n-----END CERTIFICATE-----\n")
  })
})

describe("resolveTls", () => {
  const url = new URL("https://example.com/mcp")

  test("returns undefined when no TLS options configured", async () => {
    await expect(McpTls.resolveTls({}, "/workspace", url)).resolves.toBeUndefined()
  })

  test("resolves CA from ca_pem", async () => {
    await expect(McpTls.resolveTls({ ca_pem: SAMPLE_CERT }, "/workspace", url)).resolves.toEqual({ ca: SAMPLE_CERT })
  })

  test("resolves CA from ca_file", async () => {
    using dir = tmpdir()
    await expect(
      McpTls.resolveTls({ ca_file: writeTempFile(dir.path, "ca.pem", SAMPLE_CERT) }, dir.path, url),
    ).resolves.toEqual({ ca: SAMPLE_CERT_TRIMMED })
  })

  test("concatenates ca_pem and ca_file", async () => {
    using dir = tmpdir()
    await expect(
      McpTls.resolveTls({ ca_pem: SAMPLE_CERT, ca_file: writeTempFile(dir.path, "ca2.pem", SAMPLE_CERT) }, dir.path, url),
    ).resolves.toEqual({ ca: SAMPLE_CERT + SAMPLE_CERT_TRIMMED })
  })

  test("throws if ca_pem is not valid PEM", async () => {
    await expect(McpTls.resolveTls({ ca_pem: "not a cert" }, "/workspace", url)).rejects.toThrow(
      "missing PEM certificate header",
    )
  })

  test("throws if ca_file does not exist", async () => {
    await expect(McpTls.resolveTls({ ca_file: "nonexistent.pem" }, "/workspace", url)).rejects.toThrow("CA file not found")
  })

  test("throws if fingerprint is invalid format", async () => {
    await expect(McpTls.resolveTls({ fingerprint: "not-a-fingerprint" }, "/workspace", url)).rejects.toThrow(
      "Invalid SHA256 fingerprint",
    )
  })

  test("accepts a matching fingerprint against the presented certificate", async () => {
    const server = await startTlsMcpServer()
    try {
      await expect(
        McpTls.resolveTls({ fingerprint: FINGERPRINT }, import.meta.dir, new URL(server.url)),
      ).resolves.toEqual({ fingerprint: FINGERPRINT })
    } finally {
      await server.close()
    }
  })

  test("throws on a fingerprint mismatch before connecting", async () => {
    const server = await startTlsMcpServer()
    try {
      await expect(
        McpTls.resolveTls({ fingerprint: "a".repeat(64) }, import.meta.dir, new URL(server.url)),
      ).rejects.toThrow("fingerprint mismatch")
    } finally {
      await server.close()
    }
  })
})

describe("withTls", () => {
  test("injects tls.ca and preserves the caller's init", async () => {
    const calls: Array<{ url: string | URL; init?: RequestInit }> = []
    const base = ((url: string | URL, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(new Response("ok"))
    }) as typeof fetch

    await McpTls.withTls({ ca: SAMPLE_CERT }, base)("https://example.com/mcp", { method: "POST", headers: { a: "b" } })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://example.com/mcp")
    const init = calls[0].init as BunFetchRequestInit
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({ a: "b" })
    expect(init.tls).toEqual({ ca: SAMPLE_CERT })
  })

  test("works when the caller passes no init", async () => {
    const calls: Array<{ init?: RequestInit }> = []
    const base = ((_: string | URL, init?: RequestInit) => {
      calls.push({ init })
      return Promise.resolve(new Response("ok"))
    }) as typeof fetch

    await McpTls.withTls({ ca: SAMPLE_CERT }, base)("https://example.com/mcp")

    expect((calls[0].init as BunFetchRequestInit).tls).toEqual({ ca: SAMPLE_CERT })
  })

  test("disables certificate validation and installs the fingerprint check for a pin", async () => {
    const calls: Array<{ init?: RequestInit }> = []
    const base = ((_: string | URL, init?: RequestInit) => {
      calls.push({ init })
      return Promise.resolve(new Response("ok"))
    }) as typeof fetch

    await McpTls.withTls({ fingerprint: FINGERPRINT }, base)("https://127.0.0.1:8443/mcp")

    const tls = (calls[0].init as BunFetchRequestInit).tls
    expect(tls?.rejectUnauthorized).toBe(false)
    const check = tls?.checkServerIdentity
    expect(typeof check).toBe("function")
    const der = Buffer.from(CERT.split("\n").slice(1, -1).join(""), "base64")
    expect(check!("127.0.0.1", { raw: der } as PeerCertificate)).toBeUndefined()
    const mismatch = check!("127.0.0.1", { raw: Buffer.alloc(32) } as PeerCertificate)
    expect(mismatch).toBeInstanceOf(Error)
    expect((mismatch as Error).message).toContain("fingerprint mismatch")
  })
})

describe("isTlsCertificateError", () => {
  const tlsErrors: Array<[string, unknown]> = [
    ["self-signed message (bun)", new Error("self signed certificate")],
    ["altname message", new Error('ERR_TLS_CERT_ALTNAME_INVALID fetching "https://127.0.0.1:8443/mcp"')],
    ["expired message", new Error("certificate has expired")],
    ["node depth-zero code", Object.assign(new Error("self-signed certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" })],
    ["node self-signed-in-chain code", Object.assign(new Error("unable to verify the first certificate"), { code: "SELF_SIGNED_CERT_IN_CHAIN" })],
    ["caused by a self-signed error", Object.assign(new TypeError("fetch failed"), { cause: new Error("self signed certificate") })],
    ["nested cause", Object.assign(new Error("connect failed"), { cause: Object.assign(new Error("tls error"), { cause: new Error("certificate has expired") }) })],
  ]
  for (const [name, error] of tlsErrors) test(`matches ${name}`, () => expect(McpTls.isTlsCertificateError(error)).toBe(true))

  const otherErrors: Array<[string, unknown]> = [
    ["connection refused", new Error("Unable to connect. Is the computer able to access the url?")],
    ["http failure", new Error("HTTP error: 500 Internal Server Error")],
    ["bare fetch failed", new TypeError("fetch failed")],
    ["timeout", new Error("Request timed out after 30000ms")],
    ["non-error value", "self signed certificate is not the issue"],
    ["null", null],
  ]
  for (const [name, error] of otherErrors) test(`rejects ${name}`, () => expect(McpTls.isTlsCertificateError(error)).toBe(false))
})

// The fingerprint is the SHA256 of the DER body, the same value
// tls.getPeerX509Certificate().fingerprint256 reports.
const FINGERPRINT = createHash("sha256")
  .update(Buffer.from(CERT.split("\n").slice(1, -1).join(""), "base64"))
  .digest("hex")
const FINGERPRINT_APPLIANCE = createHash("sha256")
  .update(Buffer.from(CERT_APPLIANCE.split("\n").slice(1, -1).join(""), "base64"))
  .digest("hex")

const connect = (name: string, config: ConfigMCP.Remote) =>
  McpClient.connect(name, config, import.meta.dir).pipe(Effect.provide(hostEnvironmentLayer))

// The connection lives only as long as use; closing the scope tears the transport down.
const withConnection = <A, E>(
  name: string,
  config: ConfigMCP.Remote,
  use: (connection: McpClient.Connection) => Effect.Effect<A, E>,
) => Effect.scoped(connect(name, config).pipe(Effect.flatMap(use)))

describe("MCP connect over TLS", () => {
  test("trusts a self-signed server via ca_file", async () => {
    const server = await startTlsMcpServer()
    try {
      await Effect.runPromise(
        withConnection(
          "tls-ca",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false, tls: { ca_file: path.join(TLS_FIXTURE_DIR, "localhost.crt") } }),
          (connection) =>
            connection.tools().pipe(Effect.map((tools) => expect(tools.map((tool) => tool.name)).toEqual(["echo"]))),
        ),
      )
    } finally {
      await server.close()
    }
  })

  test("trusts a self-signed server via ca_pem", async () => {
    const server = await startTlsMcpServer()
    try {
      await Effect.runPromise(
        withConnection(
          "tls-pem",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false, tls: { ca_pem: CERT } }),
          (connection) =>
            connection.tools().pipe(Effect.map((tools) => expect(tools.map((tool) => tool.name)).toEqual(["echo"]))),
        ),
      )
    } finally {
      await server.close()
    }
  })

  test("pins the certificate by fingerprint against an IP host", async () => {
    const server = await startTlsMcpServer()
    try {
      await Effect.runPromise(
        withConnection(
          "tls-pin",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false, tls: { fingerprint: FINGERPRINT } }),
          (connection) =>
            connection.tools().pipe(Effect.map((tools) => expect(tools.map((tool) => tool.name)).toEqual(["echo"]))),
        ),
      )
    } finally {
      await server.close()
    }
  })

  test("a fingerprint pin reaches an appliance certificate without IP SANs", async () => {
    const server = await startTlsMcpServer({ cert: CERT_APPLIANCE, key: KEY_APPLIANCE })
    try {
      const resolved = await McpTls.resolveTls({ fingerprint: FINGERPRINT_APPLIANCE }, import.meta.dir, new URL(server.url))
      if (!resolved || !("fingerprint" in resolved) || resolved.fingerprint !== FINGERPRINT_APPLIANCE)
        throw new Error(`unexpected resolved tls: ${JSON.stringify(resolved)}`)
      // A bare GET is rejected by the streamable transport, so prove the trust with an initialize.
      const response = await McpTls.withTls(resolved, globalThis.fetch)(server.url, {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "opencode", version: "1.0.0" } },
        }),
      })
      expect(response.status).toBe(200)
      await response.body?.cancel()
    } finally {
      await server.close()
    }
  })

  test("connects an appliance certificate without IP SANs via a fingerprint pin", async () => {
    const server = await startTlsMcpServer({ cert: CERT_APPLIANCE, key: KEY_APPLIANCE })
    try {
      await Effect.runPromise(
        withConnection(
          "tls-appliance",
          new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false, tls: { fingerprint: FINGERPRINT_APPLIANCE } }),
          (connection) =>
            connection.tools().pipe(Effect.map((tools) => expect(tools.map((tool) => tool.name)).toEqual(["echo"]))),
        ),
      )
    } finally {
      await server.close()
    }
  })

  test("rejects a fingerprint mismatch before connecting", async () => {
    const server = await startTlsMcpServer()
    try {
      const exit = await Effect.runPromise(
        Effect.scoped(
          connect("tls-bad-pin", new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false, tls: { fingerprint: "a".repeat(64) } })),
        ).pipe(Effect.exit),
      )
      if (Exit.isSuccess(exit)) throw new Error("connect unexpectedly succeeded")
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(McpClient.ConnectError)
      if (!(error instanceof McpClient.ConnectError)) throw new Error("expected ConnectError")
      expect(error.message).toContain("fingerprint mismatch")
    } finally {
      await server.close()
    }
  })

  test("rejects a certificate no configured CA signed", async () => {
    const server = await startTlsMcpServer()
    try {
      const exit = await Effect.runPromise(
        Effect.scoped(
          connect("tls-wrong-ca", new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false, tls: { ca_pem: SAMPLE_CERT } })),
        ).pipe(Effect.exit),
      )
      if (Exit.isSuccess(exit)) throw new Error("connect unexpectedly succeeded")
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(McpClient.ConnectError)
    } finally {
      await server.close()
    }
  })
})
