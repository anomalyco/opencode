import { test, expect, describe } from "bun:test"
import { isPrivateIp, assertPublicUrl, parseCharset, decodeBody } from "../../src/tool/webfetch"

describe("isPrivateIp", () => {
  const priv = [
    // IPv4
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "192.0.0.8", // IETF protocol assignments
    "192.0.2.1", // TEST-NET-1
    "198.18.0.1", // benchmarking
    "198.19.255.255", // benchmarking
    "198.51.100.7", // TEST-NET-2
    "203.0.113.9", // TEST-NET-3
    "224.0.0.1", // multicast
    "240.0.0.1", // reserved
    "255.255.255.255", // broadcast
    // IPv6
    "::1",
    "::",
    "0:0:0:0:0:0:0:1", // loopback, uncompressed — string checks like a === "::1" miss this
    "fe80::1",
    "FE80::1",
    "febf::1", // still inside fe80::/10
    "fec0::1", // deprecated site-local
    "fd00::1",
    "fc00::1",
    "ff02::1", // multicast
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1", // NAT64 embedding 127.0.0.1
    "2002:7f00:1::", // 6to4 embedding 127.0.0.1
    "fe80::1%eth0", // zone id
  ]
  const pub = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.32.0.1",
    "172.15.0.1",
    "100.63.0.1",
    "100.128.0.1",
    "198.17.0.1",
    "198.20.0.1",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "::ffff:808:808", // IPv4-mapped 8.8.8.8 — mapped form of a PUBLIC address stays public
    "64:ff9b::808:808", // NAT64 embedding 8.8.8.8
    "fe00::1", // outside fe80::/10
  ]

  test.each(priv)("treats %s as private", (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })
  test.each(pub)("treats %s as public", (ip) => {
    expect(isPrivateIp(ip)).toBe(false)
  })
})

describe("assertPublicUrl", () => {
  const blocked = [
    "http://localhost/",
    "http://localhost./", // trailing dot must not bypass the name check
    "http://foo.local/",
    "http://metadata.google.internal/",
    "http://anything.internal/",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://[::1]/",
    "http://[0:0:0:0:0:0:0:1]/",
    "http://[fe80::1]:8080/",
    "http://[::ffff:169.254.169.254]/",
    // WHATWG URL normalizes non-dotted numeric hosts to IPv4 dotted form
    "http://2130706433/", // 127.0.0.1 as a decimal integer
    "http://0x7f000001/", // 127.0.0.1 in hex
  ]
  test.each(blocked)("rejects %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow()
  })

  test("allows a public IP literal without DNS", async () => {
    await expect(assertPublicUrl("http://1.1.1.1/")).resolves.toBeUndefined()
  })

  test("allows a public IPv6 literal without DNS", async () => {
    await expect(assertPublicUrl("http://[2606:4700:4700::1111]/")).resolves.toBeUndefined()
  })
})

describe("parseCharset", () => {
  test("extracts a charset label", () => {
    expect(parseCharset("text/html; charset=Shift_JIS")).toBe("shift_jis")
  })
  test("strips surrounding quotes", () => {
    expect(parseCharset('text/html; charset="utf-8"')).toBe("utf-8")
  })
  test("tolerates spacing", () => {
    expect(parseCharset("text/html ; charset = windows-1252")).toBe("windows-1252")
  })
  test("returns undefined when absent", () => {
    expect(parseCharset("text/html")).toBeUndefined()
    expect(parseCharset("")).toBeUndefined()
  })
})

describe("decodeBody", () => {
  test("decodes windows-1252 declared bodies", () => {
    // 0x93/0x94 are curly quotes in windows-1252 but invalid lead bytes in UTF-8.
    const bytes = new Uint8Array([0x93, 0x68, 0x69, 0x94])
    expect(decodeBody(bytes, "text/html; charset=windows-1252")).toBe("“hi”")
  })
  test("defaults to utf-8 when no charset is declared", () => {
    const bytes = new TextEncoder().encode("héllo")
    expect(decodeBody(bytes, "text/plain")).toBe("héllo")
  })
  test("falls back to utf-8 for an unsupported charset label", () => {
    const bytes = new TextEncoder().encode("ok")
    expect(decodeBody(bytes, "text/plain; charset=not-a-real-charset")).toBe("ok")
  })
})
