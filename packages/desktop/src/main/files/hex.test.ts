import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
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

test("a stale version marker is ignored; a discovery document or the selected exe counts", async () => {
  const support = await mkdtemp(path.join(tmpdir(), "hex-detect-"))

  try {
    const paths = { support, registry: path.join(support, "missing-reg.exe") }
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
})
