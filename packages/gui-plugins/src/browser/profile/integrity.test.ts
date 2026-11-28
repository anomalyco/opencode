import { expect, test } from "bun:test"
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { extensionDigest } from "./integrity"

test("approval binds the bytes and the names, not timestamps, file sizes or just the manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "extension-digest-"))

  try {
    const script = path.join(root, "script.js")
    await writeFile(script, "abc")
    const approved = await extensionDigest(root)
    expect(approved).toHaveLength(64)
    await writeFile(script, "def")
    expect(await extensionDigest(root)).not.toBe(approved)
    await writeFile(script, "abc")
    expect(await extensionDigest(root)).toBe(approved)
    await rename(script, path.join(root, "other.js"))
    expect(await extensionDigest(root)).not.toBe(approved)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
