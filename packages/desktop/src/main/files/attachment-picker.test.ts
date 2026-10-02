import { describe, expect, test } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, FileSystem } from "effect"
import {
  assertAttachmentBudget,
  createPickedFileAuthorizations,
  MAX_ATTACHMENT_BYTES,
  readAttachment,
} from "./attachment-picker"

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)))

describe("attachment size limit", () => {
  test("rejects the selection before files are read when its total exceeds the limit", () => {
    expect(() =>
      assertAttachmentBudget([{ size: MAX_ATTACHMENT_BYTES / 2 }, { size: MAX_ATTACHMENT_BYTES / 2 }]),
    ).not.toThrow()
    expect(() => assertAttachmentBudget([{ size: MAX_ATTACHMENT_BYTES }, { size: 1 }])).toThrow("20 MB limit")
  })

  test("reads an approved file and rejects an oversized one before allocating its contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-attachment-"))
    const file = join(directory, "example.txt")
    const oversized = join(directory, "oversized.txt")
    try {
      await writeFile(file, "lorem ipsum")
      expect(new TextDecoder().decode(await run(readAttachment(file)))).toBe("lorem ipsum")
      await writeFile(oversized, "")
      await truncate(oversized, MAX_ATTACHMENT_BYTES + 1)
      await expect(run(readAttachment(oversized))).rejects.toThrow("20 MB limit")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("picked file authorizations", () => {
  const read = (path: string) => Effect.sync(() => new TextEncoder().encode(path).buffer)

  test("keeps concurrent picker selections isolated", async () => {
    const authorizations = createPickedFileAuthorizations(read)
    const first = authorizations.add(1, ["a.txt", "b.txt"])
    const second = authorizations.add(1, ["c.txt"])

    expect(new TextDecoder().decode(await run(authorizations.read(1, first, "a.txt")))).toBe("a.txt")
    expect(new TextDecoder().decode(await run(authorizations.read(1, second, "c.txt")))).toBe("c.txt")
    expect(new TextDecoder().decode(await run(authorizations.read(1, first, "b.txt")))).toBe("b.txt")
  })

  test("releases unread files for one picker without affecting another", async () => {
    const authorizations = createPickedFileAuthorizations(read)
    const first = authorizations.add(1, ["a.txt"])
    const second = authorizations.add(1, ["b.txt"])
    authorizations.release(1, first)

    await expect(run(authorizations.read(1, first, "a.txt"))).rejects.toThrow("not selected")
    expect(new TextDecoder().decode(await run(authorizations.read(1, second, "b.txt")))).toBe("b.txt")
  })

  test("keeps picker tokens scoped to their renderer", async () => {
    const authorizations = createPickedFileAuthorizations(read)
    const token = authorizations.add(1, ["a.txt"])

    await expect(run(authorizations.read(2, token, "a.txt"))).rejects.toThrow("not selected")
  })

  test("charges actual reads against the selection budget", async () => {
    const size = MAX_ATTACHMENT_BYTES / 2 + 1
    const authorizations = createPickedFileAuthorizations((_path, maxBytes) =>
      Effect.sync(() => {
        if (maxBytes < size) throw new Error("budget exceeded")
        return new ArrayBuffer(size)
      }),
    )
    const token = authorizations.add(1, ["a.txt", "b.txt"])

    await run(authorizations.read(1, token, "a.txt"))
    await expect(run(authorizations.read(1, token, "b.txt"))).rejects.toThrow("budget exceeded")
  })
})
