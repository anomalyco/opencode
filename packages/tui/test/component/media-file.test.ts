import { expect, test } from "bun:test"
import { mkdir, readdir, stat, utimes } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  createMediaFiles,
  MEDIA_FILE_LIMITS,
  pruneMediaFiles,
  resolveImageSource,
  resolveVideoFile,
  serverFileExists,
} from "../../src/component/media/file"
import { tmpdir } from "../fixture/fixture"
import { image, imageFixture, video, videoFixture } from "../fixture/media"

const bytes = new Uint8Array(await Bun.file(videoFixture).arrayBuffer())
const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
const base64 = Buffer.from(bytes).toString("base64")

test("media files are written once, atomically, under their content hash", async () => {
  await using temporary = await tmpdir()
  const files = createMediaFiles(temporary.path)
  const file = path.join(temporary.path, `${sha256}.mp4`)
  await expect(files.ensure(sha256, ".mp4", () => Promise.reject(new Error("offline")))).rejects.toThrow("offline")
  const release = Promise.withResolvers<Uint8Array>()
  const asked = Promise.withResolvers<void>()
  let reads = 0
  const read = () => {
    reads++
    asked.resolve()
    return release.promise
  }
  const pending = [files.ensure(sha256, ".mp4", read), files.ensure(sha256, ".mp4", read)]
  await asked.promise
  expect(await Bun.file(file).exists()).toBe(false)
  release.resolve(bytes)
  expect(await Promise.all(pending)).toEqual([file, file])
  expect(await files.ensure(sha256, ".mp4", read)).toBe(file)
  expect(reads).toBe(1)
  expect(await readdir(temporary.path)).toEqual([`${sha256}.mp4`])
})

test("media files unused for a week go, then the least recently used until the rest fit, and a hit is a use", async () => {
  await using temporary = await tmpdir()
  const day = 24 * 60 * 60 * 1000
  // Written oldest first, so the directory's order is not the order of use.
  const files = { unused: 8, "stale.mp4.0.tmp": 2, oldest: 3, older: 2, new: 0, "writing.mp4.1.tmp": 0 }
  for (const [name, days] of Object.entries(files)) {
    const file = path.join(temporary.path, name)
    await Bun.write(file, "0123456789")
    const time = new Date(Date.now() - days * day)
    await utimes(file, time, time)
  }
  await mkdir(path.join(temporary.path, "directory"))
  await pruneMediaFiles(temporary.path, { ...MEDIA_FILE_LIMITS, bytes: Infinity })
  const left = ["directory", "new", "older", "oldest", "writing.mp4.1.tmp"]
  expect((await readdir(temporary.path)).toSorted()).toEqual(left)
  const media = createMediaFiles(temporary.path, { ...MEDIA_FILE_LIMITS, bytes: 20 })
  await media.pruned
  expect((await readdir(temporary.path)).toSorted()).toEqual(left.filter((name) => name !== "oldest"))
  expect(MEDIA_FILE_LIMITS).toEqual({ unusedMs: 7 * day, bytes: 2 * 1024 ** 3, temporaryMs: day })

  const older = path.join(temporary.path, "older")
  expect(await media.ensure("older", "", () => Promise.reject(new Error("offline")))).toBe(older)
  expect(Date.now() - (await stat(older)).mtimeMs).toBeLessThan(day)
})

test("file uris play in place on a local server and are read through a remote one, whatever its OS", async () => {
  await using temporary = await tmpdir()
  const reads: unknown[] = []
  const remote = {
    files: createMediaFiles(temporary.path),
    localServer: false,
    readFile: async (input: unknown) => {
      reads.push(input)
      return bytes
    },
    media: { read: async () => bytes },
  }
  const local = { ...remote, localServer: true }
  const uri = pathToFileURL(videoFixture).href
  const fixtures = { directory: path.dirname(path.dirname(videoFixture)) }
  const windows = { directory: "C:\\work" }
  const posix = { directory: "/work" }
  const data = "data:image/png;base64,AAAA"
  const gone = pathToFileURL(path.join(temporary.path, "gone.mp4")).href
  const at = (extension: string) => path.join(temporary.path, sha256 + extension)
  const resolve = (item: Parameters<typeof resolveImageSource>[0], sources = remote) =>
    item.kind === "video" ? resolveVideoFile(item, sources) : resolveImageSource(item, sources)
  const cases = [
    [video("data", { uri: `data:;base64,${base64}`, path: undefined, mime: "video/quicktime" }), remote, at(".mov")],
    [video("ref", { uri: `media:${sha256}`, path: undefined, mime: "video/x-m4v" }), remote, at(".m4v")],
    [video("draft", { uri: "data:," }), remote, videoFixture],
    [video("local", { uri, path: undefined }), local, videoFixture],
    [image("local", { uri: pathToFileURL(imageFixture).href, path: undefined }), local, imageFixture],
    [image("data", { uri: data, path: undefined }), remote, data],
    // A sent attachment plays the file a local server read it from, or its copy once that is gone or on a remote one.
    [video("sent", { uri: `media:${sha256}`, path: undefined, source: uri }), local, videoFixture],
    [video("sent", { uri: `media:${sha256}`, path: undefined, source: gone }), local, at(".mp4")],
    [image("sent", { uri: data, path: undefined, source: pathToFileURL(imageFixture).href }), remote, data],
    [image("sent", { uri: data, path: undefined, source: "file://host/share/a.png" }), local, data],
    [image("gone", { uri: data, path: path.join(temporary.path, "gone.png") }), remote, data],
    [video("remote", { uri, path: undefined, location: fixtures }), remote, at(".mp4")],
    [image("windows", { uri: "file:///C:/work/out/a%20b.png", path: undefined, location: windows }), remote, bytes],
    [image("posix", { uri: "file:///work/a%5Cb.png", path: undefined, location: posix }), remote, bytes],
  ] as const
  for (const [item, sources, expected] of cases) expect(await resolve(item, sources), `${item.kind} ${item.id}`).toEqual(expected)
  expect(reads).toEqual([
    { path: "media/video-only.mp4", location: fixtures },
    { path: "out/a b.png", location: windows },
    { path: "a\\b.png", location: posix },
  ])
  // This machine's files and the network stay out of reach: no location, outside it, another host, or another scheme.
  for (const item of [
    image("x", { uri, path: undefined }),
    image("x", { uri, path: undefined, location: { directory: "/elsewhere" } }),
    image("x", { uri: "file:///E:/other/c.png", path: undefined, location: windows }),
    image("x", { uri: "file://host/share/a.png", path: undefined, location: { directory: "/" } }),
    image("x", { uri: "https://example.com/a.png", path: undefined, location: { directory: "/" } }),
  ])
    await expect(resolve(item)).rejects.toThrow()
  await expect(resolve(image("x", { uri: "file://host/share/a.png", path: undefined }), local)).rejects.toThrow()
  expect(reads).toHaveLength(3)
})

// Every listed directory holds `demo.mp4` and `sub\clip.mp4`, so a check outside the session's directory would find
// one.
test.each([
  ["/work/out/demo.mp4", "/work", ["out"], true],
  ["/work/demo.mp4", "/work", ["."], true],
  // On a POSIX server a backslash is part of the name, not a way out of the directory.
  ["/work/a\\..\\..\\outside\\demo.mp4", "/work", ["."], false],
  ["/work/sub\\clip.mp4", "/work", ["."], true],
  ["/work/clip.mp4", "/work", ["."], false],
  ["/elsewhere/demo.mp4", "/work", [], false],
  ["C:\\work\\out\\demo.mp4", "C:\\work", ["out"], true],
  // On a Windows server it separates names.
  ["C:\\work\\clip.mp4", "C:\\work", ["."], true],
  ["C:\\other\\demo.mp4", "C:\\work", [], false],
] as const)("a remote server's %p is looked for in a listing only inside %p", async (file, directory, paths, found) => {
  const listed: string[] = []
  const sources = {
    files: createMediaFiles(directory),
    localServer: false,
    listFiles: async (input: { path: string }) => {
      listed.push(input.path)
      return ["demo.mp4", "sub\\clip.mp4"].map((name) => ({ path: `${input.path}/${name}`, type: "file" }))
    },
  }
  expect(await serverFileExists(file, { directory }, sources)).toBe(found)
  expect(listed).toEqual([...paths])
})

test("a remote server's missing directory holds no file, and another failure leaves the answer unknown", async () => {
  const failing = (error: Error) => ({
    files: createMediaFiles("/work"),
    localServer: false,
    listFiles: () => Promise.reject(error),
  })
  const missing = Object.assign(new Error("gone"), { _tag: "FileNotFoundError" })
  expect(await serverFileExists("/work/out/a.mp4", { directory: "/work" }, failing(missing))).toBe(false)
  const offline = serverFileExists("/work/out/a.mp4", { directory: "/work" }, failing(new Error("offline")))
  await expect(offline).rejects.toThrow("offline")
})
