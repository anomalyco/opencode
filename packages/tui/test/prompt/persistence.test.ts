import { expect, test } from "bun:test"
import path from "path"
import { mkdir, mkdtemp, rm, stat } from "fs/promises"
import { tmpdir } from "os"
import { appendText, readJson, readText, writeJsonAtomic, writeText } from "../../src/util/persistence"

test("persistence creates parent directories and supports text, append, and JSON", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-tui-persistence-"))
  try {
    const textPath = path.join(root, "nested", "state.jsonl")
    await writeText(textPath, "one\n")
    await appendText(textPath, "two\n")
    expect(await readText(textPath)).toBe("one\ntwo\n")

    const jsonPath = path.join(root, "other", "state.json")
    await writeJsonAtomic(jsonPath, { value: 1 })
    expect(await readJson<{ value: number }>(jsonPath)).toEqual({ value: 1 })
    await writeJsonAtomic(jsonPath, { value: 2 })
    expect(await readJson<{ value: number }>(jsonPath)).toEqual({ value: 2 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// So a reader sees the old or the new text, never part of it.
test("a rewrite replaces the file instead of writing into it", async () => {
  await using root = await temporaryRoot()
  const file = path.join(root.path, "prompt-history.jsonl")
  await writeText(file, "old\n")
  const replaced = (await stat(file)).ino
  await writeText(file, "new\n")
  expect((await stat(file)).ino).not.toBe(replaced)
  expect(await readText(file)).toBe("new\n")
})

// An append made during a rewrite would otherwise go to the file the rename replaces.
test("an append made during a rewrite lands in the new file, after a failed write and under another spelling of its path", async () => {
  await using root = await temporaryRoot()
  const file = path.join(root.path, "prompt-stash.jsonl")
  // A directory with an entry cannot be renamed over.
  await mkdir(path.join(file, "entry"), { recursive: true })
  await expect(writeText(file, "A\n")).rejects.toThrow()
  await rm(file, { recursive: true })
  await writeText(file, "A\n")
  await Promise.all([writeText(path.relative(process.cwd(), file), ""), appendText(file, "B\n")])
  expect(await readText(file)).toBe("B\n")
})

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-tui-persistence-"))
  return { path: root, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}
