import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { detectHex, hexPaths } from "./hex"

test("uses the Hex installers' per-user layouts and desktop PATH", () => {
  const mac = hexPaths("darwin", "/Users/test", { PATH: "/bin" })
  expect([...mac]).toContain("/Users/test/Applications/Hex.app/Contents/MacOS/hex")
  expect([...mac]).toContain("/bin/hex")

  const windows = hexPaths("win32", "C:\\Users\\test", { APPDATA: "D:\\roaming", PATH: "D:\\bin;C:\\tools" })
  expect([...windows]).toContain("D:\\roaming\\hex\\current-version")
  expect([...windows]).toContain("C:\\tools\\hex.com")

  const linux = hexPaths("linux", "/home/test", { XDG_DATA_HOME: "/data" })
  expect([...linux]).toContain("/data/applications/anomaly.hex.desktop")
  expect([...linux]).toContain("/data/hex/service.sock")
  expect([...linux]).toContain("/usr/bin/hex")
})

test("retained Hex settings alone do not count as an installation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hex-detect-"))

  try {
    const support = path.join(root, "hex")
    await mkdir(support)
    await writeFile(path.join(support, "settings.json"), "{}")
    const marker = path.join(support, "current-version")
    expect(await detectHex([marker])).toBe(false)
    await writeFile(marker, "3.1.0")
    expect(await detectHex([marker])).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
