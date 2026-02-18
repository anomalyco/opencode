import { describe, expect, test } from "bun:test"
import { Installation } from "../../src/installation"

describe("installation command", () => {
  test("returns a manual command for win32 npm-style installs", () => {
    expect(Installation.command("npm", "1.2.6", "win32")).toBe("npm install -g opencode-ai@1.2.6")
    expect(Installation.command("pnpm", "1.2.6", "win32")).toBe("pnpm install -g opencode-ai@1.2.6")
    expect(Installation.command("bun", "1.2.6", "win32")).toBe("bun install -g opencode-ai@1.2.6")
    expect(Installation.command("yarn", "1.2.6", "win32")).toBe("yarn global add opencode-ai@1.2.6")
  })

  test("uses npm fallback for win32 curl installs", () => {
    expect(Installation.command("curl", "1.2.6", "win32")).toBe("npm install -g opencode-ai@1.2.6")
  })

  test("returns nothing for non-manual win32 methods", () => {
    expect(Installation.command("scoop", "1.2.6", "win32")).toBeUndefined()
    expect(Installation.command("choco", "1.2.6", "win32")).toBeUndefined()
  })

  test("returns nothing on non-win32 platforms", () => {
    expect(Installation.command("npm", "1.2.6", "darwin")).toBeUndefined()
    expect(Installation.command("curl", "1.2.6", "linux")).toBeUndefined()
  })
})

describe("installation warning", () => {
  test("includes actionable win32 guidance", () => {
    const msg = Installation.warning("npm", "1.2.6", "win32")
    expect(msg).toContain("Windows npm upgrades are run manually")
    expect(msg).toContain("npm install -g opencode-ai@1.2.6")
    expect(msg).toContain("%APPDATA%\\npm\\node_modules\\.opencode-*")
  })

  test("returns nothing when no manual warning is needed", () => {
    expect(Installation.warning("scoop", "1.2.6", "win32")).toBeUndefined()
    expect(Installation.warning("npm", "1.2.6", "linux")).toBeUndefined()
  })
})
