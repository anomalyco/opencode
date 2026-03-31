import { describe, expect, spyOn, test } from "bun:test"
import { PackageRegistry } from "../../src/bun/registry"

describe("PackageRegistry.isOutdated", () => {
  test("treats invalid cached versions as outdated", async () => {
    const spy = spyOn(PackageRegistry, "info").mockResolvedValue("1.3.2")

    try {
      const result = await PackageRegistry.isOutdated("@opencode-ai/plugin", "dev", "/tmp/opencode-config")

      expect(result).toBe(true)
      expect(spy).toHaveBeenCalledWith("@opencode-ai/plugin", "version", "/tmp/opencode-config")
    } finally {
      spy.mockRestore()
    }
  })

  test("treats invalid cached ranges as outdated", async () => {
    const spy = spyOn(PackageRegistry, "info").mockResolvedValue("1.3.2")

    try {
      const result = await PackageRegistry.isOutdated("@opencode-ai/plugin", "latest || dev", "/tmp/opencode-config")

      expect(result).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  test("ignores invalid latest versions from registry", async () => {
    const spy = spyOn(PackageRegistry, "info").mockResolvedValue("dev")

    try {
      const result = await PackageRegistry.isOutdated("@opencode-ai/plugin", "1.3.2", "/tmp/opencode-config")

      expect(result).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})
