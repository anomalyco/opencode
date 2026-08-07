import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Failed, NotFound, WrongKind, type Files } from "../../src/environment/index"

export interface EnvironmentHarness {
  readonly files: Files
  readonly root: string
  readonly symlink?: (target: string, path: string) => Effect.Effect<void, Failed>
}

export const environmentConformance = (
  name: string,
  makeHarness: () => EnvironmentHarness | Promise<EnvironmentHarness>,
  skip = false,
) => {
  const check = (title: string, body: (harness: EnvironmentHarness) => Promise<void>) =>
    test(title, async () => {
      const harness = await makeHarness()
      await Effect.runPromise(harness.files.mkdir(harness.root))
      try {
        await body(harness)
      } finally {
        await Effect.runPromise(harness.files.remove(harness.root))
      }
    })

  const bytes = (value: string) => new TextEncoder().encode(value)
  const text = (value: Uint8Array) => new TextDecoder().decode(value)
  const failure = <E>(effect: Effect.Effect<unknown, E>) => Effect.runPromise(Effect.flip(effect))

  const suite = skip ? describe.skip : describe

  suite(name, () => {
    check("writes, stats, and reads a file with its info", async ({ files, root }) => {
      const target = `${root}/hello.txt`
      await Effect.runPromise(files.write(target, bytes("hello")))
      const result = await Effect.runPromise(files.read(target))
      expect(text(result.bytes)).toBe("hello")
      expect(result.info.type).toBe("file")
      expect(result.info.size).toBe(5)
      expect(await Effect.runPromise(files.stat(target))).toEqual(result.info)
    })

    check("reports missing paths", async ({ files, root }) => {
      const target = `${root}/missing`
      expect(await failure(files.read(target))).toBeInstanceOf(NotFound)
      expect(await failure(files.stat(target))).toBeInstanceOf(NotFound)
      expect(await failure(files.list(target))).toBeInstanceOf(NotFound)
      expect(await failure(files.move(target, `${root}/other`))).toBeInstanceOf(NotFound)
    })

    check("reports the actual kind", async ({ files, root }) => {
      const directory = `${root}/directory`
      const file = `${root}/file`
      await Effect.runPromise(files.mkdir(directory))
      await Effect.runPromise(files.write(file, bytes("data")))
      const readError = await failure(files.read(directory))
      const listError = await failure(files.list(file))
      expect(readError).toBeInstanceOf(WrongKind)
      expect((readError as WrongKind).actual).toBe("directory")
      expect(listError).toBeInstanceOf(WrongKind)
      expect((listError as WrongKind).actual).toBe("file")
    })

    check("write creates parent directories", async ({ files, root }) => {
      const target = `${root}/one/two/file`
      await Effect.runPromise(files.write(target, bytes("nested")))
      await Effect.runPromise(files.write(`${root}/empty`, new Uint8Array()))
      expect((await Effect.runPromise(files.stat(`${root}/one/two`))).type).toBe("directory")
      expect(await Effect.runPromise(files.stat(`${root}/empty`))).toMatchObject({ type: "file", size: 0 })
      expect(text((await Effect.runPromise(files.read(target))).bytes)).toBe("nested")
    })

    check("reads byte ranges", async ({ files, root }) => {
      const target = `${root}/range`
      await Effect.runPromise(files.write(target, bytes("0123456789")))
      expect(text((await Effect.runPromise(files.read(target, { offset: 2, length: 4 }))).bytes)).toBe("2345")
      expect(text((await Effect.runPromise(files.read(target, { offset: 8, length: 8 }))).bytes)).toBe("89")
      expect(text((await Effect.runPromise(files.read(target, { offset: 20, length: 4 }))).bytes)).toBe("")
    })

    check("lists immediate entries with their kinds", async ({ files, root }) => {
      await Effect.runPromise(files.write(`${root}/file name`, bytes("data")))
      await Effect.runPromise(files.mkdir(`${root}/directory`))
      await Effect.runPromise(files.write(`${root}/directory/nested`, bytes("nested")))
      const entries = await Effect.runPromise(files.list(root))
      expect(entries.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: "directory", type: "directory" },
        { name: "file name", type: "file" },
      ])
    })

    check("reports symlinks without resolving them", async (harness) => {
      if (!harness.symlink) return
      await Effect.runPromise(harness.files.write(`${harness.root}/target`, bytes("target")))
      await Effect.runPromise(harness.files.write(`${harness.root}/target-dir/file`, bytes("through link")))
      await Effect.runPromise(harness.symlink("target", `${harness.root}/link`))
      await Effect.runPromise(harness.symlink("target-dir", `${harness.root}/link-dir`))
      expect((await Effect.runPromise(harness.files.stat(`${harness.root}/link`))).type).toBe("symlink")
      expect(await Effect.runPromise(harness.files.list(harness.root))).toContainEqual({
        name: "link",
        type: "symlink",
      })
      expect(text((await Effect.runPromise(harness.files.read(`${harness.root}/link-dir/file`))).bytes)).toBe(
        "through link",
      )
    })

    check("follows symlinks when reading", async (harness) => {
      if (!harness.symlink) return
      await Effect.runPromise(harness.files.write(`${harness.root}/target`, bytes("target content")))
      await Effect.runPromise(harness.files.mkdir(`${harness.root}/directory`))
      await Effect.runPromise(harness.symlink("target", `${harness.root}/file-link`))
      await Effect.runPromise(harness.symlink("directory", `${harness.root}/directory-link`))
      await Effect.runPromise(harness.symlink("missing", `${harness.root}/dangling-link`))

      const result = await Effect.runPromise(harness.files.read(`${harness.root}/file-link`))
      expect(text(result.bytes)).toBe("target content")
      expect(result.info.type).toBe("file")
      expect(result.info.size).toBe(bytes("target content").length)

      const directoryError = await failure(harness.files.read(`${harness.root}/directory-link`))
      expect(directoryError).toBeInstanceOf(WrongKind)
      expect((directoryError as WrongKind).actual).toBe("directory")
      expect(await failure(harness.files.read(`${harness.root}/dangling-link`))).toBeInstanceOf(NotFound)
    })

    check("moves files and removes trees idempotently", async ({ files, root }) => {
      const source = `${root}/source/file`
      const destination = `${root}/destination`
      await Effect.runPromise(files.write(source, bytes("moved")))
      await Effect.runPromise(files.move(source, destination))
      expect(text((await Effect.runPromise(files.read(destination))).bytes)).toBe("moved")
      expect(await failure(files.stat(source))).toBeInstanceOf(NotFound)
      await Effect.runPromise(files.remove(`${root}/source`))
      await Effect.runPromise(files.remove(`${root}/source`))
      expect(await failure(files.stat(`${root}/source`))).toBeInstanceOf(NotFound)
    })
  })
}
