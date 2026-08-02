import { describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir as osTmpdir } from "node:os"
import path from "node:path"
import {
  createTlsFetch,
  readCaFile,
  resolveFilePath,
  validateFingerprint,
  validatePemCert,
} from "../../src/mcp/tls"

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
aBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgH
jIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoP
qRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqNvWxVyZaBcDeFgHjIkLmNoPqRsTqNXv
-----END CERTIFICATE-----
`

const SAMPLE_CA_BUNDLE = `${SAMPLE_CERT}\n${SAMPLE_CERT}`

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
    expect(() => validatePemCert(SAMPLE_CERT, "test")).not.toThrow()
  })

  test("accepts a CA bundle with multiple certificates", () => {
    expect(() => validatePemCert(SAMPLE_CA_BUNDLE, "test")).not.toThrow()
  })

  test("rejects content without BEGIN marker", () => {
    expect(() => validatePemCert("just some text", "test")).toThrow("missing PEM certificate header")
  })

  test("rejects content with BEGIN but no END marker", () => {
    expect(() =>
      validatePemCert("-----BEGIN CERTIFICATE-----\nbase64data", "test"),
    ).toThrow("missing PEM certificate footer")
  })

  test("rejects content with empty body between markers", () => {
    expect(() =>
      validatePemCert("-----BEGIN CERTIFICATE-----\n\n-----END CERTIFICATE-----", "test"),
    ).toThrow("empty PEM certificate body")
  })

  test("rejects non-PEM content masquerading with partial markers", () => {
    expect(() => validatePemCert("-----BEGIN CERT-----not real-----END CERT-----", "test")).toThrow(
      "missing PEM certificate header",
    )
  })

  test("includes the source name in error messages", () => {
    expect(() => validatePemCert("bad content", "caPem config entry")).toThrow("caPem config entry")
  })
})

describe("validateFingerprint", () => {
  test("accepts bare hex fingerprint", () => {
    const result = validateFingerprint("a" .repeat(64))
    expect(result).toBe("a" .repeat(64))
  })

  test("accepts colon-separated fingerprint", () => {
    const result = validateFingerprint("AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99")
    expect(result).toHaveLength(64)
    expect(result).not.toContain(":")
    expect(result).not.toContain("SHA256")
  })

  test("accepts SHA256: prefixed fingerprint", () => {
    const result = validateFingerprint("SHA256:" + "a" .repeat(64))
    expect(result).toBe("a" .repeat(64))
  })

  test("accepts SHA256: prefixed with colons", () => {
    const result = validateFingerprint("SHA256:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99")
    expect(result).toHaveLength(64)
  })

  test("lowercases the result", () => {
    const result = validateFingerprint("AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99")
    expect(result).toBe(result.toLowerCase())
  })

  test("trims whitespace", () => {
    const result = validateFingerprint("  " + "a" .repeat(64) + "  ")
    expect(result).toBe("a" .repeat(64))
  })

  test("rejects empty string", () => {
    expect(() => validateFingerprint("")).toThrow("Invalid SHA256 fingerprint")
  })

  test("rejects wrong length hex", () => {
    expect(() => validateFingerprint("a" .repeat(63))).toThrow("Invalid SHA256 fingerprint")
    expect(() => validateFingerprint("a" .repeat(65))).toThrow("Invalid SHA256 fingerprint")
  })

  test("rejects non-hex characters", () => {
    expect(() => validateFingerprint("g" + "a" .repeat(63))).toThrow("Invalid SHA256 fingerprint")
  })

  test("rejects wrong prefix", () => {
    expect(() => validateFingerprint("SHA1:" + "a" .repeat(64))).toThrow("Invalid SHA256 fingerprint")
    expect(() => validateFingerprint("MD5:" + "a" .repeat(64))).toThrow("Invalid SHA256 fingerprint")
  })

  test("rejects SQL injection attempt in fingerprint", () => {
    expect(() => validateFingerprint("' OR '1'='1")).toThrow("Invalid SHA256 fingerprint")
  })

  test("rejects shell injection attempt in fingerprint", () => {
    expect(() => validateFingerprint("$(rm -rf /)")).toThrow("Invalid SHA256 fingerprint")
  })
})

describe("resolveFilePath", () => {
  test("expands ~ to home directory", () => {
    const result = resolveFilePath("~/test/file.pem", "/workspace")
    expect(result).not.toContain("~")
    expect(result).toContain("test")
  })

  test("returns absolute paths as-is", () => {
    const result = resolveFilePath("/absolute/path/ca.pem", "/workspace")
    expect(result).toBe("/absolute/path/ca.pem")
  })

  test("resolves relative paths against workspace", () => {
    const result = resolveFilePath("certs/ca.pem", "/workspace")
    expect(result).toBe(path.resolve("/workspace", "certs/ca.pem"))
  })
})

describe("readCaFile", () => {
  test("reads a valid PEM file", () => {
    using dir = tmpdir()
    const filePath = writeTempFile(dir.path, "ca.pem", SAMPLE_CERT)
    const content = readCaFile(filePath, dir.path)
    expect(content).toBe(SAMPLE_CERT)
  })

  test("resolves relative paths against workspace", () => {
    using dir = tmpdir()
    writeTempFile(dir.path, "ca.pem", SAMPLE_CERT)
    const content = readCaFile("ca.pem", dir.path)
    expect(content).toBe(SAMPLE_CERT)
  })

  test("throws if file does not exist", () => {
    expect(() => readCaFile("nonexistent.pem", "/workspace")).toThrow("CA file not found")
  })

  test("throws if path is a directory", () => {
    using dir = tmpdir()
    expect(() => readCaFile(dir.path, dir.path)).toThrow("CA path is not a file")
  })

  test("throws if file does not contain PEM cert", () => {
    using dir = tmpdir()
    const filePath = writeTempFile(dir.path, "bad.pem", "not a certificate")
    expect(() => readCaFile(filePath, dir.path)).toThrow("missing PEM certificate header")
  })

  test("throws if file is empty", () => {
    using dir = tmpdir()
    const filePath = writeTempFile(dir.path, "empty.pem", "")
    expect(() => readCaFile(filePath, dir.path)).toThrow()
  })

  test("includes original filePath in error messages", () => {
    expect(() => readCaFile("nonexistent.pem", "/workspace")).toThrow("nonexistent.pem")
  })
})

describe("createTlsFetch", () => {
  test("returns a function", () => {
    const customFetch = createTlsFetch(SAMPLE_CERT)
    expect(typeof customFetch).toBe("function")
  })

  test("injects tls.ca into requests made to HTTPS URLs", async () => {
    const customFetch = createTlsFetch(SAMPLE_CERT)

    let capturedInit: any = undefined
    const originalFetch = globalThis.fetch
    globalThis.fetch = ((_input: any, init: any) => {
      capturedInit = init
      return Promise.resolve(new Response("ok"))
    }) as typeof fetch

    try {
      await customFetch("https://example.com/test", { method: "POST" })
      expect(capturedInit).toBeDefined()
      expect(capturedInit.tls).toBeDefined()
      expect(capturedInit.tls.ca).toBe(SAMPLE_CERT)
      expect(capturedInit.method).toBe("POST")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
