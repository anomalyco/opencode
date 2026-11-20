import { expect, test } from "bun:test"
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { detectHex, hexPaths } from "./hex"

test("uses Rune's per-platform installation paths", () => {
  expect(hexPaths("darwin", "/home/test", { PATH: "/bin" })).toEqual({
    support: "/home/test/Library/Application Support/hex",
    bundles: ["/Applications/Hex.app", "/home/test/Applications/Hex.app"],
  })
  expect(hexPaths("win32", "C:\\Users\\test", { APPDATA: "D:\\roaming", PATH: "C:\\tools" })).toEqual({
    support: "D:\\roaming\\hex",
    registry: "C:\\Windows\\System32\\reg.exe",
  })

  const linux = hexPaths("linux", "/home/test", {
    XDG_DATA_HOME: "relative",
    XDG_DATA_DIRS: "relative:/opt/share",
    PATH: ":/bin:.",
  })

  expect(linux).toEqual({
    support: "/home/test/.local/share/hex",
    entries: [
      "/home/test/.local/share/applications/anomaly.hex.desktop",
      "/home/test/.local/share/applications/hex.desktop",
      "/opt/share/applications/anomaly.hex.desktop",
      "/opt/share/applications/hex.desktop",
    ],
    binaries: ["/home/test/.local/bin/hex", "/bin/hex"],
  })
})

// The fake `reg` is a shell script, which Windows can't run.
test.skipIf(process.platform === "win32")(
  "a stale version marker is ignored; a discovery document or the selected exe counts",
  async () => {
    const support = await mkdtemp(path.join(tmpdir(), "hex-detect-"))

    try {
      const paths = { support, registry: await fakeRegistry(support, 1) }
      await writeFile(path.join(support, "current-version"), "2.3.0\r\n")
      expect(await detectHex(paths)).toBe(false)
      await writeFile(path.join(support, "local-api.json"), "")
      expect(await detectHex(paths)).toBe(true)
      await rm(path.join(support, "local-api.json"))
      const version = path.join(support, "versions", "2.3.0")
      await mkdir(version, { recursive: true })
      await writeFile(path.join(version, "hex.exe"), "")
      expect(await detectHex(paths)).toBe(true)
    } finally {
      await rm(support, { recursive: true, force: true })
    }
  },
)

test.skipIf(process.platform === "win32")(
  "a registry query that fails for any reason but a missing key is unknown",
  async () => {
    const support = await mkdtemp(path.join(tmpdir(), "hex-detect-"))

    try {
      expect(await detectHex({ support, registry: await fakeRegistry(support, 1) })).toBe(false)
      await expect(detectHex({ support, registry: await fakeRegistry(support, 5) })).rejects.toThrow()
      await expect(detectHex({ support, registry: path.join(support, "missing-reg.exe") })).rejects.toThrow()
    } finally {
      await rm(support, { recursive: true, force: true })
    }
  },
)

test("a path that can't be checked is unknown, not missing", async () => {
  const support = await mkdtemp(path.join(tmpdir(), "hex-detect-"))

  try {
    expect(await detectHex({ support, bundles: [path.join(support, "Hex.app")] })).toBe(false)
    await expect(detectHex({ support, bundles: [path.join(support, "x".repeat(300))] })).rejects.toThrow()
  } finally {
    await rm(support, { recursive: true, force: true })
  }
})

// Stands in for `reg.exe`, exiting with `exitCode`.
async function fakeRegistry(dir: string, exitCode: number) {
  const file = path.join(dir, `reg-${exitCode}`)
  await writeFile(file, `#!/bin/sh\nexit ${exitCode}\n`)
  await chmod(file, 0o755)

  return file
}
