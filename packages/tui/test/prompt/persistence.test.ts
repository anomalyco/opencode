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
