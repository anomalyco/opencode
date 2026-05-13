import { describe, expect, test } from "bun:test"

import type { Configuration } from "electron-builder"

import { getCurrentSidecar, SIDECAR_BINARIES, windowsify } from "./utils"

describe("sidecar utils", () => {
  test("SIDECAR_BINARIES has an entry for every supported electron-builder target", () => {
    const targets = SIDECAR_BINARIES.map((b) => b.rustTarget).sort()
    expect(targets).toEqual([
      "aarch64-apple-darwin",
      "aarch64-pc-windows-msvc",
      "aarch64-unknown-linux-gnu",
      "x86_64-apple-darwin",
      "x86_64-pc-windows-msvc",
      "x86_64-unknown-linux-gnu",
    ])
  })

  test("getCurrentSidecar resolves the Linux x64 baseline binary", () => {
    expect(getCurrentSidecar("x86_64-unknown-linux-gnu").ocBinary).toBe("opencode-linux-x64-baseline")
  })

  test("getCurrentSidecar throws for an unknown target", () => {
    expect(() => getCurrentSidecar("riscv64-unknown-linux-gnu")).toThrow(/Sidecar configuration not available/)
  })

  test("windowsify only appends .exe on win32", () => {
    expect(windowsify("resources/opencode-cli")).toBe(
      process.platform === "win32" ? "resources/opencode-cli.exe" : "resources/opencode-cli",
    )
    expect(windowsify("resources/opencode-cli.exe")).toBe("resources/opencode-cli.exe")
  })
})

describe("electron-builder config", () => {
  test("packages opencode-cli as an extra resource so it ends up in the deb", async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = "prod"
    try {
      const mod: { default: Configuration } = await import(`./../electron-builder.config.ts?t=${Date.now()}`)
      const config = mod.default

      const binary = `opencode-cli${process.platform === "win32" ? ".exe" : ""}`
      const resources = config.extraResources
      expect(Array.isArray(resources)).toBe(true)
      const entry =
        Array.isArray(resources) &&
        resources
          .filter((r): r is { from: string; to: string } => typeof r === "object" && r !== null && "to" in r)
          .find((r) => r.to === binary)
      expect(entry).toBeTruthy()
      expect(entry && entry.from).toBe(`resources/${binary}`)

      expect(config.deb?.afterInstall).toBe("scripts/deb-after-install.sh")
      expect(config.deb?.afterRemove).toBe("scripts/deb-after-remove.sh")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CHANNEL
      else process.env.OPENCODE_CHANNEL = previous
    }
  })
})
