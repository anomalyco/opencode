import { afterEach, describe, expect, test } from "bun:test"
import { assertPublicUrl, isPrivateIp, isBlockedHostname } from "../../src/util/url-safety"

const ORIGINAL = process.nv.OPEN_CODE_WEBFETCH_ALLOW_PRIVATE

afterEach(() => {
  if (ORIGINAL === undefined) delete process.nv.OPEN_CODE_WEBFETCH_ALLOW_PRIVATE
  else process.nv.OPEN_CODE_WEBFETCH_ALLOW_PRIVATE = ORIGINAL
})

async function blocked(url: string) {
  try {
    await assertPublicUrl(url)
  } catch (e) {
    expect(e instanceof Error ? e.message : String(e)).toContain("private/internal")
    return
  }
  throw new Error(`expected ${url} to be blocked`)
}

describe("isPrivateIp", () => {
  const cases: [string, boolean][] = [
    ["127.0.0.1", true],
    ["127.1.2.3", true], // whole 127/8 is loopback
    ["10.0.0.5", true],
    ["10.255.255.255", true],
    ["172.16.0.1", true],
    ["172.31.255.254", true],
    ["172.15.0.1", false],
    ["172.32.0.1", false],
    ["192.168.1.1", true],
    ["192.167.1.1", false],
    ["169.254.169.254", true], // cloud metadata
    ["169.254.0.1", true],
    ["100.64.0.1", true], // CGNAT
    ["100.127.255.255", true],
    ["100.63.255.255", false],
    ["0.0.0.0", true],
    ["0.1.2.3", true],
    ["255.255.255.255", true],
    ["224.0.0.1", true], // multicast
    ["240.0.0.1", true], // reserved
    ["198.18.0.1", true], // benchmarking
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["::1", true],
    ["::", true],
    ["0:0:0:0:0:0:0:1", true], // full-form loopback
    ["0:0:0:0:0:0:0:0", true], // full-form unspecified
    ["0:0:0:0:0:0:0:2", false],
    ["fc00::1", true], // ULA
    ["fd12:3456::1", true],
    ["fe80::1", true], // link-local
    ["febf::1", true],
    ["ff02::1", true], // multicast
    ["::ffff:127.0.0.1", true], // IPv4-mapped loopback
    ["::ffff:10.1.2.3", true],
    ["::ffff:8.8.8.8", false],
    ["::ffff:7f00:1", true], // hex-mapped loopback
    ["2001:db8::1", true], // documentation range
    ["2001:4860:4860::8888", false], // google dns
    ["2606:4700:4700::1111", false],
    ["not-an-ip", false],
  ]
  for (const [ip, expected] of cases) {
    test(`${ip} → ${expected}`, () => {
      expect(isPrivateIp(ip)).toBe(expected)
    })
  }
})

describe("isBlockedHostname", () => {
  const cases: [string, boolean][] = [
    ["localhost", true],
    ["LOCALHOST", true],
    ["localhost.", true], // trailing dot
    ["foo.localhost", true],
    ["localhost.localdomain", true],
    ["metadata.google.internal", true],
    ["host.docker.internal", true],
    ["printer.lan", true],
    ["nas.local", true],
    ["router.home.arpa", true],
    ["example.com", false],
    ["localhosts.com", false], // suffix must not over-match
    ["mylocal.com", false],
  ]
  for (const [host, expected] of cases) {
    test(`${host} → ${expected}`, () => {
      expect(isBlockedHostname(host)).toBe(expected)
    })
  }
})

describe("assertPublicUrl", () => {
  test("blocks loopback hostname", () => blocked("http://localhost:8080/"))
  test("blocks IPv4 loopback", () => blocked("http://127.0.0.1:8080/"))
  test("blocks IPv6 loopback", () => blocked("http://[::1]:8080/"))
  test("blocks decimal IPv4 loopback (WHATWG normalization)", () => blocked("http://2130706433/"))
  test("blocks hex IPv4 loopback", () => blocked("http://0x7f000001/"))
  test("blocks octal IPv4 loopback", () => blocked("http://0177.0.0.1/"))
  test("blocks AWS metadata endpoint", () => blocked("http://169.254.169.254/latest/meta-data"))
  test("blocks GCP metadata hostname", () => blocked("http://metadata.google.internal/"))
  test("blocks RFC1918 address", () => blocked("http://192.168.1.1/"))

  test("blocks non-http(s) schemes", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow("scheme")
    await expect(assertPublicUrl("gopher://example.com/")).rejects.toThrow("scheme")
  })

  test("allows when opt-out flag is set", async () => {
    process.env.OPENCODE_WEBFETCH_ALLOW_PRIVATE = "1"
    await assertPublicUrl("http://localhost:8080/")
    await assertPublicUrl("http://127.0.0.1:8080/")
    await assertPublicUrl("http://169.254.169.254/")
  })
})
