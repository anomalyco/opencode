import { expect, test } from "bun:test"
import path from "path"
import { mkdtemp, rm } from "fs/promises"
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

test("a reader sees the old or the new text while it is rewritten, never part of it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-tui-persistence-"))
  try {
    const file = path.join(root, "prompt-history.jsonl")
    const [old, next] = ["a", "b"].map((line) => `${line.repeat(1023)}\n`.repeat(16 * 1024))
    await writeText(file, old!)
    let done = false
    const write = writeText(file, next!).finally(() => (done = true))
    const reads: string[] = []
    while (!done) reads.push(await readText(file))
    await write
    expect(reads.filter((text) => text !== old && text !== next).length).toBe(0)
    expect(await readText(file)).toBe(next!)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("an append made while the file is rewritten lands in the new file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-tui-persistence-"))
  try {
    const file = path.join(root, "prompt-stash.jsonl")
    await writeText(file, "A\n")
    await Promise.all([writeText(file, ""), appendText(file, "B\n")])
    expect(await readText(file)).toBe("B\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
