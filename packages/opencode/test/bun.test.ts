import { describe, expect, test, spyOn } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { BunProc } from "../src/bun"
import { Global } from "../src/global"

describe("BunProc registry configuration", () => {
  test("should not contain hardcoded registry parameters", async () => {
    // Read the bun/index.ts file
    const bunIndexPath = path.join(__dirname, "../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Verify that no hardcoded registry is present
    expect(content).not.toContain("--registry=")
    expect(content).not.toContain("hasNpmRcConfig")
    expect(content).not.toContain("NpmRc")
  })

  test("should use Bun's default registry resolution", async () => {
    // Read the bun/index.ts file
    const bunIndexPath = path.join(__dirname, "../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Verify that it uses Bun's default resolution
    expect(content).toContain("Bun's default registry resolution")
    expect(content).toContain("Bun will use them automatically")
    expect(content).toContain("No need to pass --registry flag")
  })

  test("should have correct command structure without registry", async () => {
    // Read the bun/index.ts file
    const bunIndexPath = path.join(__dirname, "../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Extract the install function
    const installFunctionMatch = content.match(/export async function install[\s\S]*?^  }/m)
    expect(installFunctionMatch).toBeTruthy()

    if (installFunctionMatch) {
      const installFunction = installFunctionMatch[0]

      // Verify expected arguments are present
      expect(installFunction).toContain('"add"')
      expect(installFunction).toContain('"--force"')
      expect(installFunction).toContain('"--exact"')
      expect(installFunction).toContain('"--cwd"')
      expect(installFunction).toContain("Global.Path.cache")
      expect(installFunction).toContain('pkg + "@" + version')

      // Verify no registry argument is added
      expect(installFunction).not.toContain('"--registry"')
      expect(installFunction).not.toContain('args.push("--registry')
    }
  })
})

describe("BunProc.install latest caching", () => {
  test("skips install when latest is already recorded and module exists", async () => {
    const suffix = Math.random().toString(36).slice(2)
    const pkg = `@opencode-test/bunproc-recorded-${suffix}`
    const modPath = path.join(Global.Path.cache, "node_modules", pkg)
    const cachePackagePath = path.join(Global.Path.cache, "package.json")

    await fs.mkdir(modPath, { recursive: true })
    await Bun.write(path.join(modPath, "package.json"), JSON.stringify({ name: pkg, version: "3.2.1" }))
    await Bun.write(cachePackagePath, JSON.stringify({ dependencies: { [pkg]: "3.2.1" } }))

    const runSpy = spyOn(BunProc, "run").mockImplementation(async () => {
      throw new Error("BunProc.run should not be called in this test")
    })

    try {
      const result = await BunProc.install(pkg, "latest")
      expect(result).toBe(modPath)
      expect(runSpy).toHaveBeenCalledTimes(0)
    } finally {
      runSpy.mockRestore()
    }
  })

  test("records installed version when latest is requested and module exists", async () => {
    const suffix = Math.random().toString(36).slice(2)
    const pkg = `@opencode-test/bunproc-latest-${suffix}`
    const modPath = path.join(Global.Path.cache, "node_modules", pkg)
    const cachePackagePath = path.join(Global.Path.cache, "package.json")

    await fs.mkdir(modPath, { recursive: true })
    await Bun.write(path.join(modPath, "package.json"), JSON.stringify({ name: pkg, version: "4.5.6" }))
    await Bun.write(cachePackagePath, JSON.stringify({ dependencies: { [pkg]: "latest" } }))

    const runSpy = spyOn(BunProc, "run").mockImplementation(async () => {
      throw new Error("BunProc.run should not be called in this test")
    })

    try {
      const result = await BunProc.install(pkg, "latest")
      const cachePackage = await Bun.file(cachePackagePath).json()
      expect(result).toBe(modPath)
      expect(cachePackage.dependencies[pkg]).toBe("4.5.6")
      expect(runSpy).toHaveBeenCalledTimes(0)
    } finally {
      runSpy.mockRestore()
    }
  })
})
