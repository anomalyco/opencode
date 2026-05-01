import { describe, expect, test } from "bun:test"
import { serviceName } from "../../src/server/mdns"

describe("serviceName", () => {
  test("uses default opencode prefix when no domain is given", () => {
    expect(serviceName(4096)).toBe("opencode-4096")
  })

  test("uses default opencode prefix for the default opencode.local domain", () => {
    expect(serviceName(4096, "opencode.local")).toBe("opencode-4096")
  })

  test("derives a unique prefix from a custom mdns domain", () => {
    expect(serviceName(4096, "vmb.local")).toBe("vmb-4096")
  })

  test("two distinct domains on the same port produce distinct names", () => {
    expect(serviceName(4096, "opencode.local")).not.toBe(serviceName(4096, "vmb.local"))
  })

  test("strips a trailing dot on the .local suffix", () => {
    expect(serviceName(4096, "vmb.local.")).toBe("vmb-4096")
  })

  test("falls back to opencode when the domain reduces to an empty prefix", () => {
    expect(serviceName(4096, ".local")).toBe("opencode-4096")
  })

  test("handles domains without the .local suffix", () => {
    expect(serviceName(4096, "my-server")).toBe("my-server-4096")
  })

  test("replaces inner dots with dashes for multi-label custom domains", () => {
    expect(serviceName(4096, "team.dev.local")).toBe("team-dev-4096")
  })

  test("trims surrounding whitespace", () => {
    expect(serviceName(4096, "  vmb.local  ")).toBe("vmb-4096")
  })
})
