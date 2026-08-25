import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { install } from "../src/persistent-pty/binary.bun"

test("installs an embedded persistent PTY executable into a content-addressed private directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-pty-binary-test-"))
  try {
    const source = path.join(root, "embedded-opencode-pty")
    const bytes = Buffer.from("test opencode-pty executable")
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    await writeFile(source, bytes)

    const first = await install(path.join(root, "bin"), { path: source, version: "test", sha256 })
    const second = await install(path.join(root, "bin"), { path: source, version: "test", sha256 })

    expect(second).toBe(first)
    expect(await readFile(first)).toEqual(bytes)
    expect((await lstat(first)).mode & 0o777).toBe(0o755)
    expect((await lstat(path.dirname(first))).mode & 0o777).toBe(0o700)

    await chmod(first, 0o600)
    expect(await install(path.join(root, "bin"), { path: source, version: "test", sha256 })).toBe(first)
    expect((await lstat(first)).mode & 0o777).toBe(0o755)

    await writeFile(first, "tampered executable")
    await expect(install(path.join(root, "bin"), { path: source, version: "test", sha256 })).rejects.toThrow(
      "Cached opencode-pty checksum mismatch",
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
