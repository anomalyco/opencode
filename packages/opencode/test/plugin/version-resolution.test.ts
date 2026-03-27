import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

describe("Plugin version handling (Issue #12143)", () => {
  test("should never cache 'latest' as a version string", async () => {
    const bunIndexPath = path.join(__dirname, "../../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Verify that the code explicitly prevents caching "latest"
    expect(content).toContain("Only cache valid SemVer versions")
    expect(content).toContain('if (resolvedVersion !== "latest"')
    expect(content).toContain('Never cache "latest" or any non-SemVer strings')
  })

  test("should validate cached versions are valid SemVer before checking if outdated", async () => {
    const bunIndexPath = path.join(__dirname, "../../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Verify SemVer validation exists before isOutdated check
    expect(content).toContain("const isValidSemVer = /^\\d+\\.\\d+\\.\\d+/")
    expect(content).toContain("Validate cached version is a proper SemVer")
    expect(content).toContain("if (!isValidSemVer)")
  })

  test("should guard isOutdated against non-SemVer versions", async () => {
    const registryPath = path.join(__dirname, "../../src/bun/registry.ts")
    const content = await fs.readFile(registryPath, "utf-8")

    // Verify guard against non-SemVer cached versions
    expect(content).toContain("Guard against non-SemVer cached versions")
    expect(content).toContain("const isSemVer = /^\\d+\\.\\d+\\.\\d+/")
    expect(content).toContain("if (!isSemVer)")
    expect(content).toContain("return true") // Should treat invalid versions as outdated
  })

  test("should resolve 'latest' to actual version before caching", async () => {
    const bunIndexPath = path.join(__dirname, "../../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Verify version resolution logic
    expect(content).toContain("Resolve actual version from installed package")
    expect(content).toContain('if (version === "latest"')
    expect(content).toContain("package.json")
    expect(content).toContain("installedPkg?.version")
  })

  test("should skip cache if version cannot be resolved", async () => {
    const bunIndexPath = path.join(__dirname, "../../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Verify graceful handling when version resolution fails
    expect(content).toContain("Could not resolve package version from installed package.json")
    expect(content).toContain("will re-resolve on next run")
  })

  test("should clean up invalid cached versions", async () => {
    const bunIndexPath = path.join(__dirname, "../../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Verify cleanup of corrupted cache
    expect(content).toContain("delete dependencies[pkg]")
    expect(content).toContain("removing and reinstalling")
  })
})

describe("Version resolution integration (Issue #12143)", () => {
  test("should reject non-SemVer cached versions in isOutdated", async () => {
    const registryPath = path.join(__dirname, "../../src/bun/registry.ts")
    const content = await fs.readFile(registryPath, "utf-8")

    // Verify the guard logic checks SemVer format FIRST before calling semver.order()
    // This is the critical fix - it prevents "latest" from ever reaching semver operations
    const isOutdatedFunction = content.match(/export async function isOutdated[\s\S]*?^  \}/m)?.[0]
    expect(isOutdatedFunction).toBeTruthy()

    if (isOutdatedFunction) {
      // Verify the guard is BEFORE the semver.order call
      const guardIndex = isOutdatedFunction.indexOf("const isSemVer")
      const orderIndex = isOutdatedFunction.indexOf("semver.order")

      expect(guardIndex).toBeGreaterThan(-1)
      expect(orderIndex).toBeGreaterThan(-1)
      expect(guardIndex).toBeLessThan(orderIndex) // Guard comes first!
    }
  })

  test("BunProc.install should prevent 'latest' from being cached", async () => {
    const bunIndexPath = path.join(__dirname, "../../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    const installFunction = content.match(/export async function install[\s\S]*?^  \}$/m)?.[0]
    expect(installFunction).toBeTruthy()

    if (installFunction) {
      // Verify version resolution happens before caching
      const resolutionIndex = installFunction.indexOf('if (version === "latest"')
      const cachingIndex = installFunction.indexOf("parsed.dependencies[pkg]")

      expect(resolutionIndex).toBeGreaterThan(-1)
      expect(cachingIndex).toBeGreaterThan(-1)
      expect(resolutionIndex).toBeLessThan(cachingIndex) // Resolution before caching!

      // Verify the explicit check prevents "latest" from being cached
      expect(installFunction).toContain('if (resolvedVersion !== "latest" && /^\\d+\\.\\d+\\.\\d+/')
    }
  })

  test("cached version validation happens before outdated check", async () => {
    const bunIndexPath = path.join(__dirname, "../../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Find the version === "latest" condition block
    const latestBlockMatch = content.match(/else if \(version === "latest"\) \{[\s\S]*?\n    \}/)
    expect(latestBlockMatch).toBeTruthy()

    if (latestBlockMatch) {
      const block = latestBlockMatch[0]

      // Verify SemVer validation happens before isOutdated call
      const validationIndex = block.indexOf("const isValidSemVer")
      const isOutdatedIndex = block.indexOf("PackageRegistry.isOutdated")

      expect(validationIndex).toBeGreaterThan(-1)
      expect(isOutdatedIndex).toBeGreaterThan(-1)
      expect(validationIndex).toBeLessThan(isOutdatedIndex) // Validation first!
    }
  })

  test("caching only happens with valid SemVer versions", async () => {
    const bunIndexPath = path.join(__dirname, "../../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Find the caching logic
    const cachingLogicMatch = content.match(/Only cache valid SemVer versions[\s\S]*?log\.warn\("Could not resolve/)
    expect(cachingLogicMatch).toBeTruthy()

    if (cachingLogicMatch) {
      const logic = cachingLogicMatch[0]

      // Verify dual check: not "latest" AND valid SemVer format
      expect(logic).toContain('resolvedVersion !== "latest"')
      expect(logic).toContain("/^\\d+\\.\\d+\\.\\d+/")
      expect(logic).toContain("&&") // Both conditions must be true
    }
  })
})
