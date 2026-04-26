import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js"
import { tmpdir } from "../fixture/fixture"
import { Archive } from "../../src/util"

async function writeZip(zipPath: string, entries: Array<{ path: string; text?: string; directory?: boolean }>) {
  const writer = new ZipWriter(new BlobWriter("application/zip"))
  for (const entry of entries) {
    await writer.add(entry.path, entry.directory ? undefined : new TextReader(entry.text ?? ""), {
      directory: entry.directory,
      useWebWorkers: false,
    })
  }
  await Bun.write(zipPath, await writer.close())
}

describe("util.archive", () => {
  test("extractZip extracts nested files", async () => {
    await using tmp = await tmpdir()
    const zipPath = path.join(tmp.path, "archive.zip")
    const destDir = path.join(tmp.path, "dest")

    await writeZip(zipPath, [
      { path: "top.txt", text: "top" },
      { path: "nested/deep/file.txt", text: "deep" },
      { path: "empty/", directory: true },
    ])

    await Archive.extractZip(zipPath, destDir)

    expect(await Bun.file(path.join(destDir, "top.txt")).text()).toBe("top")
    expect(await Bun.file(path.join(destDir, "nested", "deep", "file.txt")).text()).toBe("deep")
    expect((await fs.stat(path.join(destDir, "empty"))).isDirectory()).toBe(true)
  })

  test("extractZip rejects path traversal entries", async () => {
    await using tmp = await tmpdir()
    const zipPath = path.join(tmp.path, "archive.zip")
    const destDir = path.join(tmp.path, "dest")
    const outside = path.join(tmp.path, "outside.txt")

    await writeZip(zipPath, [{ path: "../outside.txt", text: "escaped" }])

    await expect(Archive.extractZip(zipPath, destDir)).rejects.toThrow("escapes destination")
    expect(await Bun.file(outside).exists()).toBe(false)
  })
})
