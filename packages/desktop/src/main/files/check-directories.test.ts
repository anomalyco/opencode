import { describe, expect, test } from "bun:test"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { checkDirectories } from "./check-directories"

describe("checkDirectories", () => {
  test("keeps existing directories and drops missing paths and files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-check-directories-"))
    const file = join(directory, "file.txt")
    const missing = join(directory, "missing")
    try {
      await writeFile(file, "")
      expect(
        await Effect.runPromise(checkDirectories([directory, missing, file]).pipe(Effect.provide(NodeFileSystem.layer))),
      ).toEqual([directory])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
