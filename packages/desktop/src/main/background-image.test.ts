import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { clearBackgroundImage, findBackgroundImage, saveBackgroundImage } from "./background-image"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("persists and clears a selected image", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-background-"))
  directories.push(directory)
  const source = join(directory, "source.png")
  await writeFile(source, new Uint8Array([1, 2, 3]))

  expect((await saveBackgroundImage(directory, source))?.mime).toBe("image/png")
  expect((await findBackgroundImage(directory))?.path).toBe(join(directory, "background-image.png"))

  await clearBackgroundImage(directory)
  expect(await findBackgroundImage(directory)).toBeUndefined()
})

test("rejects unsupported image formats", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-background-"))
  directories.push(directory)
  const source = join(directory, "source.svg")
  await writeFile(source, "<svg />")

  expect(saveBackgroundImage(directory, source)).rejects.toThrow("Unsupported background image format")
})

test("replaces an existing image", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-background-"))
  directories.push(directory)
  const first = join(directory, "first.png")
  const second = join(directory, "second.webp")
  await Promise.all([writeFile(first, new Uint8Array([1])), writeFile(second, new Uint8Array([2]))])

  await saveBackgroundImage(directory, first)
  await saveBackgroundImage(directory, second)

  expect((await findBackgroundImage(directory))?.mime).toBe("image/webp")
})

test("rejects images larger than 20 MB", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-background-"))
  directories.push(directory)
  const source = join(directory, "large.png")
  await writeFile(source, "")
  await truncate(source, 20 * 1024 * 1024 + 1)

  expect(saveBackgroundImage(directory, source)).rejects.toThrow("Background images must be 20 MB or smaller")
})
