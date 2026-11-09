import { expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  createMediaFiles,
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
  let reads = 0
  const read = () => {
    reads++
    return release.promise
  }
  const pending = [files.ensure(sha256, ".mp4", read), files.ensure(sha256, ".mp4", read)]
  await Bun.sleep(0)
  expect(await Bun.file(file).exists()).toBe(false)
  release.resolve(bytes)
  expect(await Promise.all(pending)).toEqual([file, file])
  expect(await files.ensure(sha256, ".mp4", read)).toBe(file)
  expect(reads).toBe(1)
  expect(await readdir(temporary.path)).toEqual([`${sha256}.mp4`])
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
  const data = "data:image/png;base64,AAAA"
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
    [image("gone", { uri: data, path: path.join(temporary.path, "gone.png") }), remote, data],
    [video("remote", { uri, path: undefined, location: fixtures }), remote, at(".mp4")],
    [image("windows", { uri: "file:///C:/work/out/a%20b.png", path: undefined, location: windows }), remote, bytes],
  ] as const
  for (const [item, sources, expected] of cases)
    expect([item.id, await resolve(item, sources)]).toEqual([item.id, expected])
  expect(reads).toEqual([
    { path: "media/video-only.mp4", location: fixtures },
    { path: "out/a b.png", location: windows },
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
  expect(reads).toHaveLength(2)
})

// Every listed directory holds `demo.mp4`, so a check outside the session's directory would find one.
test.each([
  ["/work/out/demo.mp4", "/work", ["out"], true],
  ["/work/demo.mp4", "/work", ["."], true],
  // On a POSIX server a backslash is part of the name, not a way out of the directory.
  ["/work/a\\..\\..\\outside\\demo.mp4", "/work", ["."], false],
  ["/elsewhere/demo.mp4", "/work", [], false],
  ["C:\\work\\out\\demo.mp4", "C:\\work", ["out"], true],
  ["C:\\other\\demo.mp4", "C:\\work", [], false],
] as const)("a remote server's %p is looked for in a listing only inside %p", async (file, directory, paths, found) => {
  const listed: string[] = []
  const sources = {
    files: createMediaFiles(directory),
    localServer: false,
    listFiles: async (input: { path: string }) => {
      listed.push(input.path)
      return [{ path: `${input.path}/demo.mp4`, type: "file" }]
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
