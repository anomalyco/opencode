import { expect, test } from "bun:test"
import { requiresStableMacInstaller, stableMacDownload } from "./migration"

test("uses the external stable installer only for macOS beta", () => {
  expect(requiresStableMacInstaller("darwin", "beta")).toBe(true)
  expect(requiresStableMacInstaller("darwin", "prod")).toBe(false)
  expect(requiresStableMacInstaller("win32", "beta")).toBe(false)
  expect(requiresStableMacInstaller("linux", "beta")).toBe(false)
})

test("selects the signed stable installer for the current Mac architecture", () => {
  const artifact = {
    version: "2.0.2",
    metadata: {
      files: {
        "opencode-desktop-mac-arm64.dmg": { url: "https://files.test/OpenCode-arm64.dmg" },
        "opencode-desktop-mac-x64.dmg": { url: "https://files.test/OpenCode-x64.dmg" },
      },
    },
  }

  expect(stableMacDownload(artifact, "arm64")).toEqual({
    version: "2.0.2",
    url: "https://files.test/OpenCode-arm64.dmg",
  })
  expect(stableMacDownload(artifact, "x64")).toEqual({
    version: "2.0.2",
    url: "https://files.test/OpenCode-x64.dmg",
  })
  expect(stableMacDownload(artifact, "ia32")).toBeUndefined()
  expect(stableMacDownload({ version: "2.0.2", metadata: { files: {} } }, "arm64")).toBeUndefined()
})
