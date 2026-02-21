import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

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

describe("Flag server password", () => {
  test("removes OPENCODE_SERVER_PASSWORD from env on load", async () => {
    const key = "OPENCODE_SERVER_PASSWORD"
    const original = process.env[key]
    process.env[key] = "secret"

    try {
      const flagPath = path.join(__dirname, "../src/flag/flag.ts")
      const tempPath = path.join(path.dirname(flagPath), `flag-${Date.now()}-${Math.random().toString(16).slice(2)}.ts`)
      const content = await fs.readFile(flagPath, "utf-8")
      await fs.writeFile(tempPath, content)

      const { Flag } = await import(tempPath)
      expect(Flag.OPENCODE_SERVER_PASSWORD).toBe("secret")
      expect(process.env[key]).toBeUndefined()
    } finally {
      if (original === undefined) delete process.env[key]
      else process.env[key] = original
    }
  })
})
