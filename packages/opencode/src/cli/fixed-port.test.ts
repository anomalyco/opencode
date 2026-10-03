import { describe, expect, test } from "bun:test"
import { fixedPortForCwd } from "./fixed-port"

describe("fixedPortForCwd", () => {
  test("same cwd always maps to the same port", () => {
    expect(fixedPortForCwd("/workspace/a")).toBe(fixedPortForCwd("/workspace/a"))
    expect(fixedPortForCwd("/workspace/a")).toBe(fixedPortForCwd("/workspace/a"))
  })

  test("port falls within the reserved range [40000, 60000)", () => {
    for (const dir of ["/workspace/a", "/workspace/b", "/tmp/x", "/root/home/project", "/a/b/c/d/e"]) {
      const port = fixedPortForCwd(dir)
      expect(port).toBeGreaterThanOrEqual(40000)
      expect(port).toBeLessThan(60000)
    }
  })

  test("different cwds map to different ports", () => {
    const ports = new Set(["/workspace/a", "/workspace/b", "/workspace/c", "/tmp/x", "/tmp/y"].map(fixedPortForCwd))
    expect(ports.size).toBe(5)
  })

  test("trailing slash does not change the result", () => {
    expect(fixedPortForCwd("/workspace/a")).toBe(fixedPortForCwd("/workspace/a/"))
  })

  test("parent path differs from child path", () => {
    expect(fixedPortForCwd("/workspace/a")).not.toBe(fixedPortForCwd("/workspace/a/b"))
  })
})