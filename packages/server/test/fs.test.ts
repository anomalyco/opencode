import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live(
  "browsing parents and siblings reuses the current Location and its MCP process",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const current = path.join(tmp.path, "root", "current")
      const starts = path.join(tmp.path, "starts")
      yield* Effect.promise(async () => {
        await fs.mkdir(current, { recursive: true })
        await fs.mkdir(path.join(tmp.path, "root", ".git"))
        await fs.mkdir(path.join(tmp.path, "root", "sibling", "nested"), { recursive: true })
        await fs.writeFile(path.join(tmp.path, "root", "sibling", "file.txt"), "outside")
        await fs.writeFile(starts, "")
        await fs.writeFile(
          path.join(tmp.path, "root", "opencode.json"),
          JSON.stringify({
            mcp: {
              servers: {
                filesystem: {
                  type: "local",
                  command: [process.execPath, path.join(import.meta.dir, "fixture", "mcp-starts.cjs"), starts],
                },
              },
            },
          }),
        )
      })
      const server = yield* startServer(path.join(tmp.path, "config"))
      const list = (directory: string) =>
        Effect.promise(async () => {
          const url = new URL("/api/fs/list", server.base)
          url.searchParams.set("location[directory]", current)
          url.searchParams.set("path", directory)
          const response = await fetch(url, { headers: server.headers })
          expect(response.status).toBe(200)
          const result = await response.json()
          expect(result.location.directory).toBe(current)
          return result.data
        })
      const loaded = Effect.promise(async () => {
        const response = await fetch(new URL("/api/debug/location", server.base), { headers: server.headers })
        expect(response.status).toBe(200)
        return response.json()
      })
      const count = Effect.promise(
        async () => (await fs.readFile(starts, "utf8")).trim().split("\n").filter(Boolean).length,
      )

      yield* list(".")
      expect(yield* loaded).toEqual([{ directory: current }])
      expect(
        yield* count.pipe(
          Effect.repeat({ while: (n) => n === 0, schedule: Schedule.spaced("25 millis") }),
          Effect.timeout("5 seconds"),
        ),
      ).toBe(1)

      yield* list("..")
      const sibling = yield* list("../sibling")
      expect(sibling).toEqual([
        { path: path.join("..", "sibling", "nested") + path.sep, type: "directory" },
        { path: path.join("..", "sibling", "file.txt"), type: "file" },
      ])
      expect(yield* list(path.join(tmp.path, "root", "sibling"))).toEqual(sibling)
      yield* list("../sibling/nested")
      yield* list("../sibling")
      expect(yield* loaded).toEqual([{ directory: current }])
      expect(yield* count).toBe(1)
    }),
  15_000,
)

it.live(
  "streams files with Range, conditional requests, confinement, and multi-megabyte byte integrity",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const current = path.join(tmp.path, "project")
      const outside = path.join(tmp.path, "outside")
      const largeBytes = Uint8Array.from({ length: 4 * 1024 * 1024 + 321 }, (_, i) => (i * 31 + (i >> 8)) & 0xff)

      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(current, "nested"), { recursive: true })
        await fs.mkdir(outside, { recursive: true })
        await fs.writeFile(path.join(current, "clip.mp4"), "0123456789")
        await fs.writeFile(path.join(current, "empty.bin"), "")
        await fs.writeFile(path.join(current, "large.mp4"), largeBytes)
        await fs.writeFile(path.join(current, "notes.txt"), "compressible ".repeat(1024))
        await fs.writeFile(path.join(outside, "secret.txt"), "secret")
        await fs.symlink(outside, path.join(current, "escape-link"), "junction")
      })

      const server = yield* startServer(path.join(tmp.path, "config"))
      const readUrl = (relativePath: string) => {
        const url = new URL(`/api/fs/read/${relativePath}`, server.base)
        url.searchParams.set("location[directory]", current)
        return url
      }
      const request = (relativePath: string, init?: BunFetchRequestInit) =>
        Effect.promise(() =>
          fetch(readUrl(relativePath), {
            ...init,
            headers: {
              ...server.headers,
              ...init?.headers,
            },
          }),
        )

      // 1. Full 200 read headers and body
      const full = yield* request("clip.mp4")
      expect(full.status).toBe(200)
      expect(full.headers.get("accept-ranges")).toBe("bytes")
      expect(full.headers.get("content-length")).toBe("10")
      expect(full.headers.get("content-type")).toBe("video/mp4")
      expect(full.headers.get("content-encoding")).toBeNull()
      const etag = full.headers.get("etag")
      const lastModified = full.headers.get("last-modified")
      expect(etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/)
      expect(lastModified).toBeTruthy()
      expect(yield* Effect.promise(() => full.text())).toBe("0123456789")

      // 2. HEAD probe (and HEAD with Range ignores Range)
      const head = yield* request("clip.mp4", { method: "HEAD", headers: { Range: "bytes=0-3" } })
      expect(head.status).toBe(200)
      expect(head.headers.get("accept-ranges")).toBe("bytes")
      expect(head.headers.get("content-length")).toBe("10")
      expect(head.headers.get("content-type")).toBe("video/mp4")
      expect(head.headers.get("content-range")).toBeNull()
      expect(head.headers.get("etag")).toBe(etag)
      expect(head.headers.get("last-modified")).toBe(lastModified)
      expect(yield* Effect.promise(() => head.text())).toBe("")

      // 3. Explicit, open-ended, clamped, and suffix Range forms -> 206 Partial Content
      yield* Effect.forEach(
        [
          ["bytes=0-0", "0", "bytes 0-0/10"],
          ["bytes=2-5", "2345", "bytes 2-5/10"],
          ["bytes=7-99", "789", "bytes 7-9/10"],
          ["bytes=6-", "6789", "bytes 6-9/10"],
          ["bytes=-3", "789", "bytes 7-9/10"],
          ["bytes=-99", "0123456789", "bytes 0-9/10"],
        ] as const,
        ([range, expectedBody, expectedContentRange]) =>
          Effect.gen(function* () {
            const partial = yield* request("clip.mp4", { headers: { Range: range } })
            expect({ range, status: partial.status }).toEqual({ range, status: 206 })
            expect(partial.headers.get("accept-ranges")).toBe("bytes")
            expect(partial.headers.get("content-range")).toBe(expectedContentRange)
            expect(partial.headers.get("content-length")).toBe(String(expectedBody.length))
            expect(partial.headers.get("content-type")).toBe("video/mp4")
            expect(partial.headers.get("etag")).toBe(etag)
            expect(partial.headers.get("last-modified")).toBe(lastModified)
            expect(yield* Effect.promise(() => partial.text())).toBe(expectedBody)
          }),
      )

      // 4. Unsatisfiable Range -> 416 with Content-Range: bytes */size
      yield* Effect.forEach(
        [
          ["clip.mp4", "bytes=10-12", 10],
          ["clip.mp4", "bytes=10-", 10],
          ["clip.mp4", "bytes=5-2", 10],
          ["clip.mp4", "bytes=-0", 10],
          ["empty.bin", "bytes=0-0", 0],
        ] as const,
        ([file, range, total]) =>
          Effect.gen(function* () {
            const unsatisfiable = yield* request(file, { headers: { Range: range } })
            expect({ file, range, status: unsatisfiable.status }).toEqual({ file, range, status: 416 })
            expect(unsatisfiable.headers.get("content-range")).toBe(`bytes */${total}`)
            expect(yield* Effect.promise(() => unsatisfiable.text())).toBe("")
          }),
      )

      // 5. Multi-range and malformed Range headers fall back to full 200
      yield* Effect.forEach(
        ["bytes=0-1, 4-5", "items=0-3", "bytes=", "bytes=-", "bytes=abc-def", "bytes=0-1-2"] as const,
        (range) =>
          Effect.gen(function* () {
            const fallback = yield* request("clip.mp4", { headers: { Range: range } })
            expect({ range, status: fallback.status }).toEqual({ range, status: 200 })
            expect(fallback.headers.get("content-range")).toBeNull()
            expect(fallback.headers.get("content-length")).toBe("10")
            expect(yield* Effect.promise(() => fallback.text())).toBe("0123456789")
          }),
      )

      // 6. Conditional requests: If-None-Match & If-Modified-Since -> 304 Not Modified
      if (!etag || !lastModified) return yield* Effect.die(new Error("Missing ETag or Last-Modified"))
      const strongEtag = etag.slice(2)
      yield* Effect.forEach(
        [
          ["If-None-Match", etag],
          ["If-None-Match", strongEtag],
          ["If-None-Match", `"other", ${etag}`],
          ["If-None-Match", "*"],
          ["If-Modified-Since", lastModified],
        ] as const,
        ([header, value]) =>
          Effect.gen(function* () {
            const notModified = yield* request("clip.mp4", { headers: { [header]: value } })
            expect(notModified.status).toBe(304)
            expect(notModified.headers.get("etag")).toBe(etag)
            expect(notModified.headers.get("last-modified")).toBe(lastModified)
            expect(yield* Effect.promise(() => notModified.text())).toBe("")
          }),
      )

      const modifiedSincePast = yield* request("clip.mp4", {
        headers: { "If-Modified-Since": "Wed, 01 Jan 2020 00:00:00 GMT" },
      })
      expect(modifiedSincePast.status).toBe(200)
      expect(yield* Effect.promise(() => modifiedSincePast.text())).toBe("0123456789")

      // Mismatched If-None-Match takes precedence over matching If-Modified-Since
      const mismatchIfNoneMatch = yield* request("clip.mp4", {
        headers: { "If-None-Match": 'W/"mismatch"', "If-Modified-Since": lastModified },
      })
      expect(mismatchIfNoneMatch.status).toBe(200)
      expect(yield* Effect.promise(() => mismatchIfNoneMatch.text())).toBe("0123456789")

      // 7. If-Range matching -> 206; If-Range mismatch -> full 200
      yield* Effect.forEach([etag, strongEtag, lastModified], (ifRange) =>
        Effect.gen(function* () {
          const matchedRange = yield* request("clip.mp4", {
            headers: { Range: "bytes=1-4", "If-Range": ifRange },
          })
          expect(matchedRange.status).toBe(206)
          expect(matchedRange.headers.get("content-range")).toBe("bytes 1-4/10")
          expect(yield* Effect.promise(() => matchedRange.text())).toBe("1234")
        }),
      )

      yield* Effect.forEach(['W/"stale"', '"stale"', "Wed, 01 Jan 2020 00:00:00 GMT", "not-a-date"], (ifRange) =>
        Effect.gen(function* () {
          const mismatchedRange = yield* request("clip.mp4", {
            headers: { Range: "bytes=1-4", "If-Range": ifRange },
          })
          expect(mismatchedRange.status).toBe(200)
          expect(mismatchedRange.headers.get("content-range")).toBeNull()
          expect(mismatchedRange.headers.get("content-length")).toBe("10")
          expect(yield* Effect.promise(() => mismatchedRange.text())).toBe("0123456789")
        }),
      )

      // 8. Confinement enforced (404 FileNotFoundError instead of 500)
      yield* Effect.forEach(["..%2Foutside%2Fsecret.txt", "escape-link/secret.txt", "nested"], (forbiddenPath) =>
        Effect.gen(function* () {
          const escaped = yield* request(forbiddenPath)
          expect({ forbiddenPath, status: escaped.status }).toEqual({ forbiddenPath, status: 404 })
          expect(yield* Effect.promise(() => escaped.json())).toMatchObject({
            _tag: "FileNotFoundError",
          })
        }),
      )

      // 9. Compressible files keep their exact Content-Length instead of being gzipped
      const text = yield* request("notes.txt", { headers: { "Accept-Encoding": "gzip" }, decompress: false })
      expect(text.status).toBe(200)
      expect(text.headers.get("content-encoding")).toBeNull()
      expect(text.headers.get("content-length")).toBe(String("compressible ".length * 1024))
      expect(yield* Effect.promise(() => text.text())).toBe("compressible ".repeat(1024))

      // 10. Multi-megabyte file streams byte-for-byte on full read and range slice
      const fullLarge = yield* request("large.mp4")
      expect(fullLarge.status).toBe(200)
      expect(fullLarge.headers.get("content-length")).toBe(String(largeBytes.length))
      const fullLargeReceived = new Uint8Array(yield* Effect.promise(() => fullLarge.arrayBuffer()))
      expect(fullLargeReceived.length).toBe(largeBytes.length)
      expect(Buffer.compare(fullLargeReceived, largeBytes)).toBe(0)

      const sliceStart = 1024 * 1024 + 17
      const sliceEnd = 2 * 1024 * 1024 + 519
      const partialLarge = yield* request("large.mp4", {
        headers: { Range: `bytes=${sliceStart}-${sliceEnd}` },
      })
      expect(partialLarge.status).toBe(206)
      expect(partialLarge.headers.get("content-range")).toBe(`bytes ${sliceStart}-${sliceEnd}/${largeBytes.length}`)
      expect(partialLarge.headers.get("content-length")).toBe(String(sliceEnd - sliceStart + 1))
      const partialLargeReceived = new Uint8Array(yield* Effect.promise(() => partialLarge.arrayBuffer()))
      expect(Buffer.compare(partialLargeReceived, largeBytes.subarray(sliceStart, sliceEnd + 1))).toBe(0)
    }),
  15_000,
)

it.live("opens no file for HEAD and closes it when a download is aborted", () =>
  Effect.gen(function* () {
    if (process.platform !== "linux" && process.platform !== "darwin") return
    const tmp = yield* tmpdirScoped()
    const file = path.join(tmp.path, "large.bin")
    yield* Effect.promise(() => fs.writeFile(file, new Uint8Array(32 * 1024 * 1024)))
    const real = yield* Effect.promise(() => fs.realpath(file))
    const server = yield* startServer(path.join(tmp.path, "config"))
    const url = new URL("/api/fs/read/large.bin", server.base)
    url.searchParams.set("location[directory]", tmp.path)
    const openHandles = Effect.promise(async () => {
      if (process.platform === "darwin")
        return Bun.spawnSync(["lsof", "-p", String(process.pid), "-Fn"])
          .stdout.toString()
          .split("\n")
          .filter((line) => line === `n${real}`).length
      const fds = await fs.readdir("/proc/self/fd")
      const targets = await Promise.all(fds.map((fd) => fs.readlink(`/proc/self/fd/${fd}`).catch(() => "")))
      return targets.filter((target) => target === real).length
    })

    const head = yield* Effect.promise(() => fetch(url, { method: "HEAD", headers: server.headers }))
    expect(head.status).toBe(200)
    expect(head.headers.get("content-length")).toBe(String(32 * 1024 * 1024))
    expect(yield* openHandles).toBe(0)

    const controller = new AbortController()
    const download = yield* Effect.promise(() => fetch(url, { headers: server.headers, signal: controller.signal }))
    const reader = download.body?.getReader()
    yield* Effect.promise(async () => reader?.read())
    expect(yield* openHandles).toBe(1)
    controller.abort()
    expect(
      yield* openHandles.pipe(
        Effect.repeat({ until: (count) => count === 0, schedule: Schedule.spaced("25 millis") }),
        Effect.timeout("5 seconds"),
      ),
    ).toBe(0)
  }),
)
