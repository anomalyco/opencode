import { describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { BunProc } from "../src/bun"
import { PackageRegistry } from "../src/bun/registry"
import { Global } from "../src/global"
import { Process } from "../src/util/process"

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

describe("BunProc install pinning", () => {
  test("uses pinned cache without touching registry", async () => {
    const pkg = `pin-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const ver = "1.2.3"
    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const data = path.join(Global.Path.cache, "package.json")

    await fs.mkdir(mod, { recursive: true })
    await Bun.write(path.join(mod, "package.json"), JSON.stringify({ name: pkg, version: ver }, null, 2))

    const src = await fs.readFile(data, "utf8").catch(() => "")
    const json = src ? ((JSON.parse(src) as { dependencies?: Record<string, string> }) ?? {}) : {}
    const deps = json.dependencies ?? {}
    deps[pkg] = ver
    await Bun.write(data, JSON.stringify({ ...json, dependencies: deps }, null, 2))

    const stale = spyOn(PackageRegistry, "isOutdated").mockImplementation(async () => {
      throw new Error("unexpected registry check")
    })
    const run = spyOn(Process, "run").mockImplementation(async () => {
      throw new Error("unexpected process.run")
    })

    try {
      const out = await BunProc.install(pkg, ver)
      expect(out).toBe(mod)
      expect(stale).not.toHaveBeenCalled()
      expect(run).not.toHaveBeenCalled()
    } finally {
      stale.mockRestore()
      run.mockRestore()

      await fs.rm(mod, { recursive: true, force: true })
      const end = await fs
        .readFile(data, "utf8")
        .then((item) => JSON.parse(item) as { dependencies?: Record<string, string> })
        .catch(() => undefined)
      if (end?.dependencies) {
        delete end.dependencies[pkg]
        await Bun.write(data, JSON.stringify(end, null, 2))
      }
    }
  })

  test("passes --ignore-scripts when requested", async () => {
    const pkg = `ignore-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const ver = "4.5.6"
    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const data = path.join(Global.Path.cache, "package.json")

    const run = spyOn(Process, "run").mockImplementation(async () => ({
      code: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    }))

    try {
      await fs.rm(mod, { recursive: true, force: true })
      await BunProc.install(pkg, ver, { ignoreScripts: true })

      expect(run).toHaveBeenCalled()
      const call = run.mock.calls[0]?.[0]
      expect(call).toContain("--ignore-scripts")
      expect(call).toContain(`${pkg}@${ver}`)
    } finally {
      run.mockRestore()
      await fs.rm(mod, { recursive: true, force: true })

      const end = await fs
        .readFile(data, "utf8")
        .then((item) => JSON.parse(item) as { dependencies?: Record<string, string> })
        .catch(() => undefined)
      if (end?.dependencies) {
        delete end.dependencies[pkg]
        await Bun.write(data, JSON.stringify(end, null, 2))
      }
    }
  })
})
