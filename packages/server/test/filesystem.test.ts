import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { OpenCode } from "../../client/src/promise/index"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const setup = Effect.fnUntraced(function* () {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-fs-endpoint-")))
  const directory = path.join(tmp.path, "root")
  yield* Effect.promise(() => fs.mkdir(directory))
  const handler = yield* ServerFetch.make({
    database: { path: ":memory:" },
    config: { directory: path.join(tmp.path, "config"), project: false },
    models: { fetch: false },
    fs: { filewatcher: false },
  })
  const url = new URL("http://opencode.local/api/fs/write")
  url.searchParams.set("location[directory]", directory)
  return {
    directory,
    outside: tmp.path,
    client: OpenCode.make({
      baseUrl: url.origin,
      fetch: Object.assign((input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init)), {
        preconnect: fetch.preconnect,
      }),
    }),
    write: (payload: { path: string; content: string; expected: string }) =>
      Effect.promise(() =>
        handler(
          new Request(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }),
        ),
      ),
  }
})

it.live("the generated Promise client sends base64 strings and exposes typed write conflicts", () =>
  Effect.gen(function* () {
    const server = yield* setup()
    const expected = Buffer.from("before\r\n")
    const content = Buffer.from([0xef, 0xbb, 0xbf, 0x00, 0x80, 0xff, 0x0d, 0x0a])
    yield* Effect.promise(() => fs.writeFile(path.join(server.directory, "file.bin"), expected))
    const input = {
      location: { directory: server.directory },
      path: "file.bin",
      content: content.toString("base64"),
      expected: expected.toString("base64"),
    }
    const response = yield* Effect.promise(() => server.client.file.write(input))
    expect(response.data).toBe(true)
    expect(yield* Effect.promise(() => fs.readFile(path.join(server.directory, "file.bin")))).toEqual(content)
    yield* Effect.promise(async () => {
      await expect(server.client.file.write(input)).rejects.toEqual({
        _tag: "FileSystemWriteConflictError",
        path: "file.bin",
        message: "File changed since it was read",
      })
    })
    expect(yield* Effect.promise(() => fs.readFile(path.join(server.directory, "file.bin")))).toEqual(content)
  }),
)

it.live("writes base64 payloads as exact bytes in the requested location", () =>
  Effect.gen(function* () {
    const server = yield* setup()
    yield* Effect.forEach(["caf\u00e9\n", "first\r\nsecond\r\n", "\ufeffBOM\r\n", "\x00\xff", ""], (text) =>
      Effect.gen(function* () {
        const expected = Buffer.from("original content is longer\r\n")
        const content = Buffer.from(text)
        yield* Effect.promise(() => fs.writeFile(path.join(server.directory, "file.txt"), expected))
        const response = yield* server.write({
          path: "file.txt",
          content: content.toString("base64"),
          expected: expected.toString("base64"),
        })
        expect(response.status).toBe(200)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          location: { directory: server.directory },
          data: true,
        })
        expect(yield* Effect.promise(() => fs.readFile(path.join(server.directory, "file.txt")))).toEqual(content)
      }),
    )
  }),
)

it.live("returns a typed HTTP 409 conflict and leaves changed bytes untouched", () =>
  Effect.gen(function* () {
    const server = yield* setup()
    const current = Buffer.from("new\r\n")
    yield* Effect.promise(() => fs.writeFile(path.join(server.directory, "file.txt"), current))
    yield* Effect.forEach(["old\r\n", "new\n", "\ufeffnew\r\n", ""], (text) =>
      Effect.gen(function* () {
        const response = yield* server.write({
          path: "file.txt",
          content: Buffer.from("replacement").toString("base64"),
          expected: Buffer.from(text).toString("base64"),
        })
        expect(response.status).toBe(409)
        expect(yield* Effect.promise(() => response.json())).toEqual({
          _tag: "FileSystemWriteConflictError",
          path: "file.txt",
          message: "File changed since it was read",
        })
        expect(yield* Effect.promise(() => fs.readFile(path.join(server.directory, "file.txt")))).toEqual(current)
      }),
    )
  }),
)

it.live("rejects missing files, directories, escapes, and invalid base64 without writing", () =>
  Effect.gen(function* () {
    const server = yield* setup()
    yield* Effect.promise(async () => {
      await fs.mkdir(path.join(server.directory, "inside"))
      await fs.writeFile(path.join(server.outside, "file.txt"), "before")
      await fs.writeFile(path.join(server.directory, "inside", "file.txt"), "before")
      await fs.symlink(server.outside, path.join(server.directory, "escape"), "junction")
      await fs.symlink(path.join(server.directory, "inside"), path.join(server.directory, "link"), "junction")
    })
    const payload = {
      content: Buffer.from("after").toString("base64"),
      expected: Buffer.from("before").toString("base64"),
    }
    yield* Effect.forEach(["missing.txt", "inside", "../file.txt", "escape/file.txt"], (file) =>
      Effect.gen(function* () {
        const response = yield* server.write({ path: file, ...payload })
        expect(response.status).toBe(500)
      }),
    )
    yield* Effect.forEach(["content", "expected"] as const, (field) =>
      Effect.gen(function* () {
        const response = yield* server.write({ path: "inside/file.txt", ...payload, [field]: "!not-base64!" })
        expect(response.status).toBe(400)
      }),
    )
    expect(yield* Effect.promise(() => Bun.file(path.join(server.directory, "missing.txt")).exists())).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(path.join(server.outside, "file.txt")).text())).toBe("before")
    expect(yield* Effect.promise(() => Bun.file(path.join(server.directory, "inside", "file.txt")).text())).toBe(
      "before",
    )
    const response = yield* server.write({ path: "link/file.txt", ...payload })
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => Bun.file(path.join(server.directory, "inside", "file.txt")).text())).toBe(
      "after",
    )
  }),
)
