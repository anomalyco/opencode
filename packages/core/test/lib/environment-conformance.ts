import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Failed, NotFound, WrongKind, type Files } from "@opencode/core/environment/index"

export interface EnvironmentHarness {
  readonly files: Files
  readonly root: string
  readonly symlink?: (target: string, path: string) => Effect.Effect<void, Failed>
  readonly dispose?: Effect.Effect<void>
}

export const environmentConformance = <E>(
  name: string,
  makeHarness: () => Effect.Effect<EnvironmentHarness, E>,
  skip = false,
) => {
  const check = <A, E2>(title: string, body: (harness: EnvironmentHarness) => Effect.Effect<A, E2>) =>
    test(title, () =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const harness = yield* Effect.acquireRelease(makeHarness(), (harness) =>
              Effect.gen(function* () {
                yield* Effect.ignore(harness.files.remove(harness.root))
                if (harness.dispose) yield* harness.dispose
              }),
            )
            yield* harness.files.mkdir(harness.root)
            return yield* body(harness)
          }),
        ),
      ),
    )

  const bytes = (value: string) => new TextEncoder().encode(value)
  const text = (value: Uint8Array) => new TextDecoder().decode(value)
  const suite = skip ? describe.skip : describe

  suite(name, () => {
    check("writes, stats, and reads a file with its info", (harness) =>
      Effect.gen(function* () {
        const target = `${harness.root}/hello.txt`
        yield* harness.files.write(target, bytes("hello"))
        const result = yield* harness.files.read(target)
        expect(text(result.bytes)).toBe("hello")
        expect(result.info.type).toBe("file")
        expect(result.info.size).toBe(5)
        // Reading can move the access time, so compare what reading doesn't change.
        const { atimeMs: _stat, ...stat } = yield* harness.files.stat(target)
        const { atimeMs: _read, ...read } = result.info
        expect(stat).toEqual(read)
      }),
    )

    check("observes filesystem state when an operation executes", (harness) =>
      Effect.gen(function* () {
        const target = `${harness.root}/deferred.txt`
        const source = `${harness.root}/source.txt`
        const destination = `${harness.root}/destination.txt`
        const read = harness.files.read(target)
        const stat = harness.files.stat(target)
        const list = harness.files.list(harness.root)
        const move = harness.files.move(source, destination)

        yield* harness.files.write(target, bytes("first"))
        yield* harness.files.write(source, bytes("moved"))
        expect(text((yield* read).bytes)).toBe("first")
        expect((yield* stat).size).toBe(5)
        expect(yield* list).toContainEqual({ name: "deferred.txt", type: "file" })
        yield* move
        expect(text((yield* harness.files.read(destination)).bytes)).toBe("moved")

        yield* harness.files.write(target, bytes("second"))
        expect(text((yield* read).bytes)).toBe("second")
      }),
    )

    check("reports missing paths", (harness) =>
      Effect.gen(function* () {
        const target = `${harness.root}/missing`
        expect(yield* Effect.flip(harness.files.read(target))).toBeInstanceOf(NotFound)
        expect(yield* Effect.flip(harness.files.stat(target))).toBeInstanceOf(NotFound)
        expect(yield* Effect.flip(harness.files.list(target))).toBeInstanceOf(NotFound)
        expect(yield* Effect.flip(harness.files.move(target, `${harness.root}/other`))).toBeInstanceOf(NotFound)
      }),
    )

    check("reports the actual kind", (harness) =>
      Effect.gen(function* () {
        const directory = `${harness.root}/directory`
        const file = `${harness.root}/file`
        yield* harness.files.mkdir(directory)
        yield* harness.files.write(file, bytes("data"))
        const readError = yield* Effect.flip(harness.files.read(directory))
        const listError = yield* Effect.flip(harness.files.list(file))
        expect(readError).toBeInstanceOf(WrongKind)
        expect((readError as WrongKind).actual).toBe("directory")
        expect(listError).toBeInstanceOf(WrongKind)
        expect((listError as WrongKind).actual).toBe("file")
      }),
    )

    check("write creates parent directories", (harness) =>
      Effect.gen(function* () {
        const target = `${harness.root}/one/two/file`
        yield* harness.files.write(target, bytes("nested"))
        yield* harness.files.write(`${harness.root}/empty`, new Uint8Array())
        expect((yield* harness.files.stat(`${harness.root}/one/two`)).type).toBe("directory")
        expect(yield* harness.files.stat(`${harness.root}/empty`)).toMatchObject({ type: "file", size: 0 })
        expect(text((yield* harness.files.read(target)).bytes)).toBe("nested")
      }),
    )

    check("reads byte ranges", (harness) =>
      Effect.gen(function* () {
        const target = `${harness.root}/range`
        yield* harness.files.write(target, bytes("0123456789"))
        expect(text((yield* harness.files.read(target, { offset: 2, length: 4 })).bytes)).toBe("2345")
        expect(text((yield* harness.files.read(target, { offset: 8, length: 8 })).bytes)).toBe("89")
        expect(text((yield* harness.files.read(target, { offset: 20, length: 4 })).bytes)).toBe("")
      }),
    )

    check("lists immediate entries with their kinds", (harness) =>
      Effect.gen(function* () {
        yield* harness.files.write(`${harness.root}/file name`, bytes("data"))
        yield* harness.files.mkdir(`${harness.root}/directory`)
        yield* harness.files.write(`${harness.root}/directory/nested`, bytes("nested"))
        const entries = yield* harness.files.list(harness.root)
        expect(entries.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
          { name: "directory", type: "directory" },
          { name: "file name", type: "file" },
        ])
      }),
    )

    check("preserves symlink metadata while following symlinks for content", (harness) =>
      Effect.gen(function* () {
        if (!harness.symlink) return
        yield* harness.files.write(`${harness.root}/target`, bytes("target"))
        yield* harness.files.write(`${harness.root}/target-dir/file`, bytes("through link"))
        yield* harness.symlink("../target", `${harness.root}/target-dir/entry-link`)
        yield* harness.symlink("target", `${harness.root}/link`)
        yield* harness.symlink("target-dir", `${harness.root}/link-dir`)
        yield* harness.symlink("missing", `${harness.root}/dangling-link`)
        expect((yield* harness.files.stat(`${harness.root}/link`)).type).toBe("symlink")
        expect(yield* harness.files.list(harness.root)).toContainEqual({ name: "link", type: "symlink" })
        expect(text((yield* harness.files.read(`${harness.root}/link-dir/file`)).bytes)).toBe("through link")
        expect(
          (yield* harness.files.list(`${harness.root}/link-dir`)).toSorted((a, b) => a.name.localeCompare(b.name)),
        ).toEqual([
          { name: "entry-link", type: "symlink" },
          { name: "file", type: "file" },
        ])

        const fileError = yield* Effect.flip(harness.files.list(`${harness.root}/link`))
        expect(fileError).toBeInstanceOf(WrongKind)
        expect((fileError as WrongKind).actual).toBe("file")
        expect(yield* Effect.flip(harness.files.list(`${harness.root}/dangling-link`))).toBeInstanceOf(NotFound)
      }),
    )

    check("follows symlinks when reading", (harness) =>
      Effect.gen(function* () {
        if (!harness.symlink) return
        yield* harness.files.write(`${harness.root}/target`, bytes("target content"))
        yield* harness.files.mkdir(`${harness.root}/directory`)
        yield* harness.symlink("target", `${harness.root}/file-link`)
        yield* harness.symlink("directory", `${harness.root}/directory-link`)
        yield* harness.symlink("missing", `${harness.root}/dangling-link`)

        const result = yield* harness.files.read(`${harness.root}/file-link`)
        expect(text(result.bytes)).toBe("target content")
        expect(result.info.type).toBe("file")
        expect(result.info.size).toBe(bytes("target content").length)

        const directoryError = yield* Effect.flip(harness.files.read(`${harness.root}/directory-link`))
        expect(directoryError).toBeInstanceOf(WrongKind)
        expect((directoryError as WrongKind).actual).toBe("directory")
        expect(yield* Effect.flip(harness.files.read(`${harness.root}/dangling-link`))).toBeInstanceOf(NotFound)
      }),
    )

    check("stats report POSIX metadata", (harness) =>
      Effect.gen(function* () {
        const target = `${harness.root}/meta.txt`
        yield* harness.files.write(target, bytes("hello"))
        const info = yield* harness.files.stat(target)
        expect(info.mode! & 0o170000).toBe(0o100000)
        expect(info.nlink).toBeGreaterThanOrEqual(1)
        expect(info.ino).toBeGreaterThan(0)
        for (const value of [
          info.dev,
          info.uid,
          info.gid,
          info.rdev,
          info.blksize,
          info.blocks,
          info.atimeMs,
          info.ctimeMs,
          info.birthtimeMs,
        ])
          expect(Number.isFinite(value)).toBe(true)
        expect((yield* harness.files.stat(harness.root)).mode! & 0o170000).toBe(0o040000)
      }),
    )

    check("appends, writes at an offset, and truncates", (harness) =>
      Effect.gen(function* () {
        const target = `${harness.root}/bytes.txt`
        yield* harness.files.append(target, bytes("abc"))
        yield* harness.files.append(target, bytes("def"))
        yield* harness.files.writeAt(target, bytes("XY"), 1)
        expect(text((yield* harness.files.read(target)).bytes)).toBe("aXYdef")
        yield* harness.files.writeAt(target, bytes("!"), 8)
        expect([...(yield* harness.files.read(target)).bytes]).toEqual([...bytes("aXYdef"), 0, 0, 33])
        yield* harness.files.truncate(target, 2)
        expect(text((yield* harness.files.read(target)).bytes)).toBe("aX")
        yield* harness.files.truncate(target, 4)
        expect([...(yield* harness.files.read(target)).bytes]).toEqual([97, 88, 0, 0])
        yield* harness.files.writeAt(`${harness.root}/created.txt`, bytes("new"), 0)
        expect(text((yield* harness.files.read(`${harness.root}/created.txt`)).bytes)).toBe("new")
        expect(yield* Effect.flip(harness.files.truncate(`${harness.root}/missing`, 0))).toBeInstanceOf(NotFound)
      }),
    )

    check("changes permission bits and times", (harness) =>
      Effect.gen(function* () {
        const target = `${harness.root}/mode.txt`
        yield* harness.files.write(target, bytes("x"))
        yield* harness.files.chmod(target, 0o100600)
        expect((yield* harness.files.stat(target)).mode! & 0o7777).toBe(0o600)
        yield* harness.files.utimes(target, 1_000_000_000, 2_000_000_000, true)
        const info = yield* harness.files.stat(target)
        expect(info.atimeMs).toBe(1_000_000_000)
        expect(info.mtimeMs).toBe(2_000_000_000)
        const owner = yield* harness.files.stat(target)
        yield* harness.files.chown(target, owner.uid!, owner.gid!, true)
        expect(yield* Effect.flip(harness.files.chmod(`${harness.root}/missing`, 0o644))).toBeInstanceOf(NotFound)
        expect(yield* Effect.flip(harness.files.utimes(`${harness.root}/missing`, 0, 0, true))).toBeInstanceOf(NotFound)
      }),
    )

    check("creates and reads symlinks and hard links, and resolves real paths", (harness) =>
      Effect.gen(function* () {
        if (!harness.symlink) return
        const target = `${harness.root}/real.txt`
        yield* harness.files.write(target, bytes("real"))
        yield* harness.files.symlink("real.txt", `${harness.root}/sym`)
        expect(yield* harness.files.readlink(`${harness.root}/sym`)).toBe("real.txt")
        expect((yield* harness.files.stat(`${harness.root}/sym`)).type).toBe("symlink")
        expect(yield* harness.files.realpath(`${harness.root}/sym`)).toBe(yield* harness.files.realpath(target))
        const readlinkFile = yield* Effect.flip(harness.files.readlink(target))
        expect(readlinkFile).toBeInstanceOf(WrongKind)
        expect(yield* Effect.flip(harness.files.readlink(`${harness.root}/missing`))).toBeInstanceOf(NotFound)
        expect(yield* Effect.flip(harness.files.realpath(`${harness.root}/missing`))).toBeInstanceOf(NotFound)
        // Onto an existing directory both fail, instead of creating the link inside it.
        yield* harness.files.mkdir(`${harness.root}/dir`)
        expect(yield* Effect.flip(harness.files.symlink("real.txt", `${harness.root}/dir`))).toBeInstanceOf(Failed)
        expect(yield* Effect.flip(harness.files.link(target, `${harness.root}/dir`))).toBeInstanceOf(Failed)
        expect(yield* harness.files.list(`${harness.root}/dir`)).toEqual([])
        yield* harness.files.link(target, `${harness.root}/hard.txt`)
        expect(text((yield* harness.files.read(`${harness.root}/hard.txt`)).bytes)).toBe("real")
        expect(yield* Effect.flip(harness.files.link(`${harness.root}/missing`, `${harness.root}/x`))).toBeInstanceOf(
          NotFound,
        )
      }),
    )

    check("reports filesystem space", (harness) =>
      Effect.gen(function* () {
        const info = yield* harness.files.statfs(harness.root)
        expect(info.bsize).toBeGreaterThan(0)
        expect(info.blocks).toBeGreaterThan(0)
        expect(info.bavail).toBeLessThanOrEqual(info.blocks)
        expect(yield* Effect.flip(harness.files.statfs(`${harness.root}/missing`))).toBeInstanceOf(NotFound)
      }),
    )

    check("moves files and removes trees idempotently", (harness) =>
      Effect.gen(function* () {
        const source = `${harness.root}/source/file`
        const destination = `${harness.root}/destination`
        yield* harness.files.write(source, bytes("moved"))
        yield* harness.files.move(source, destination)
        expect(text((yield* harness.files.read(destination)).bytes)).toBe("moved")
        expect(yield* Effect.flip(harness.files.stat(source))).toBeInstanceOf(NotFound)
        yield* harness.files.remove(`${harness.root}/source`)
        yield* harness.files.remove(`${harness.root}/source`)
        expect(yield* Effect.flip(harness.files.stat(`${harness.root}/source`))).toBeInstanceOf(NotFound)
      }),
    )
  })
}
