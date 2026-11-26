import { describe, expect, test } from "bun:test"
import { EgressPolicy } from "../src/egress-policy.js"

describe("EgressPolicy protection and dev loopback support", () => {
  test("blocks cloud metadata, link-local, unspecified, multicast, and IPv4-mapped/NAT64/6to4 bypasses", () => {
    const policy = EgressPolicy.makePolicy({ allowPrivateLan: true })
    const blocked = [
      ["169.254.169.254", 80, "169.254.169.254"],
      ["169.254.170.2", 80, "169.254.170.2"],
      ["100.100.100.200", 80, "100.100.100.200"],
      ["metadata.google.internal", 80, "169.254.169.254"],
      ["metadata.goog", 80, "1.1.1.1"],
      ["fd00:ec2::254", 80, "fd00:ec2::254"],
      ["fe80::1", 80, "fe80::1"],
      ["::ffff:169.254.169.254", 80, "::ffff:169.254.169.254"],
      ["64:ff9b::169.254.169.254", 80, "64:ff9b::169.254.169.254"],
      ["2002:a9fe:a9fe::1", 80, "2002:a9fe:a9fe::1"],
      ["0.0.0.0", 80, "0.0.0.0"],
      ["::", 80, "::"],
      ["224.0.0.1", 80, "224.0.0.1"],
      ["255.255.255.255", 80, "255.255.255.255"],
    ] as const
    for (const [host, port, ip] of blocked) {
      expect(policy.evaluateAddress(host, port, ip).allowed).toBe(false)
    }
    // Non-standard decimal/hex IPv4 literals resolve and classify as metadata too
    expect(EgressPolicy.parseIpLiteral("2852039166")).toEqual({ address: "169.254.169.254", family: 4 })
    expect(EgressPolicy.parseIpLiteral("0xa9fea9fe")).toEqual({ address: "169.254.169.254", family: 4 })
  })

  test("distinguishes public, loopback and explicitly granted private destinations", () => {
    const policy = EgressPolicy.makePolicy({ reservedLocalPorts: () => new Set([4096]), allowPrivateLan: false })
    const allowed = (name: string, port: number, ip: string) => policy.evaluateAddress(name, port, ip).allowed
    expect(allowed("example.com", 443, "93.184.216.34")).toBe(true)
    expect(allowed("localhost", 5173, "::1")).toBe(true)
    expect(allowed("app.localhost", 24678, "127.0.0.1")).toBe(true)
    expect(allowed("localhost", 4096, "::1")).toBe(false)
    expect(allowed("localhost", 22, "127.0.0.1")).toBe(false)
    expect(allowed("preview.example", 5173, "127.0.0.1")).toBe(false)
    expect(allowed("dev.internal", 5173, "192.168.1.50")).toBe(false)
    policy.grant("dev.internal", 5173, [24678])
    expect(allowed("dev.internal", 5173, "192.168.1.50")).toBe(true)
    expect(allowed("dev.internal", 24678, "192.168.1.50")).toBe(true)
    expect(allowed("dev.internal", 9999, "192.168.1.50")).toBe(false)
    expect(() => policy.grant("169.254.169.254", 80)).toThrow(EgressPolicy.EgressDeniedError)
    expect(() => policy.grant("localhost", 4096)).toThrow(EgressPolicy.EgressDeniedError)
    expect(() => policy.grant("dev.internal", 22)).toThrow(EgressPolicy.EgressDeniedError)
  })

  test("rejects a mixed DNS answer even when the first address is allowed", async () => {
    const policy = EgressPolicy.makePolicy({
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "::1", family: 6 },
      ],
    })
    await expect(policy.resolveTarget({ host: "preview.example", port: 5173 })).rejects.toThrow(
      EgressPolicy.EgressDeniedError,
    )
  })
})
