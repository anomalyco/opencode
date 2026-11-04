import { expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createMediaFiles, resolveImageSource, resolveVideoFile } from "../../src/component/media/file"
import type { MediaItem } from "../../src/component/media/model"
import { tmpdir } from "../fixture/fixture"
import { imageFixture, videoFixture } from "../fixture/media"

const bytes = new Uint8Array(await Bun.file(videoFixture).arrayBuffer())
const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
const video = (item: Partial<MediaItem>): MediaItem => ({
  id: "item",
  kind: "video",
  mime: "video/mp4",
  uri: "",
  ...item,
})

test("writes a data URI to a content-addressed file named for its type", async () => {
  await using temporary = await tmpdir()
  const sources = { files: createMediaFiles(temporary.path), localServer: false }
  const item = video({ uri: `data:video/mp4;base64,${Buffer.from(bytes).toString("base64")}` })

  const file = await resolveVideoFile(item, sources)
  expect(file).toBe(path.join(temporary.path, `${sha256}.mp4`))
  expect(new Uint8Array(await Bun.file(file).arrayBuffer())).toEqual(bytes)
  expect(await resolveVideoFile(video({ ...item, mime: "video/quicktime" }), sources)).toBe(
    path.join(temporary.path, `${sha256}.mov`),
  )
})

test("shares one write per file and shows it only once complete", async () => {
  await using temporary = await tmpdir()
  const files = createMediaFiles(temporary.path)
  const release = Promise.withResolvers<Uint8Array>()
  let reads = 0
  const read = () => {
    reads++
    return release.promise
  }
  const file = path.join(temporary.path, `${sha256}.mp4`)

  const pending = [files.ensure(sha256, ".mp4", read), files.ensure(sha256, ".mp4", read)]
  await Bun.sleep(0)
  expect(await Bun.file(file).exists()).toBe(false)
  release.resolve(bytes)

  expect(await Promise.all(pending)).toEqual([file, file])
  expect(reads).toBe(1)
  // A file already in place is reused without reading the bytes again.
  expect(await files.ensure(sha256, ".mp4", read)).toBe(file)
  expect(reads).toBe(1)
  expect(await readdir(temporary.path)).toEqual([`${sha256}.mp4`])
})

test("a failed read leaves no file and the next request retries", async () => {
  await using temporary = await tmpdir()
  const files = createMediaFiles(temporary.path)
  await expect(files.ensure(sha256, ".mp4", () => Promise.reject(new Error("offline")))).rejects.toThrow("offline")
  expect(await readdir(temporary.path).catch(() => [])).toEqual([])
  expect(await files.ensure(sha256, ".mp4", () => Promise.resolve(bytes))).toBe(
    path.join(temporary.path, `${sha256}.mp4`),
  )
})

test("names a media ref's file by its hash and reads it through the client once", async () => {
  await using temporary = await tmpdir()
  const files = createMediaFiles(temporary.path)
  const requested: string[] = []
  const media = {
    read: (uri: string) => {
      requested.push(uri)
      return Promise.resolve(bytes)
    },
  }
  const item = video({ uri: `media:${sha256}` })

  expect(await resolveVideoFile(item, { files, localServer: false, media })).toBe(
    path.join(temporary.path, `${sha256}.mp4`),
  )
  await resolveVideoFile(item, { files, localServer: false, media })
  expect(requested).toEqual([`media:${sha256}`])
  await expect(
    resolveVideoFile(item, { files: createMediaFiles(temporary.path + "-other"), localServer: false }),
  ).rejects.toThrow()
})

test("plays local files in place and reads remote ones through the server", async () => {
  await using temporary = await tmpdir()
  const files = createMediaFiles(path.join(temporary.path, "media"))
  const uri = pathToFileURL(videoFixture).href
  const location = { directory: path.dirname(path.dirname(videoFixture)) }
  const reads: unknown[] = []
  const readFile = (input: { path: string; location: { directory: string } }) => {
    reads.push(input)
    return Promise.resolve(bytes)
  }
  const remote = { files, localServer: false, readFile }

  expect(await resolveVideoFile(video({ uri: "data:,", path: videoFixture }), { files, localServer: false })).toBe(
    videoFixture,
  )
  expect(await resolveVideoFile(video({ uri }), { files, localServer: true })).toBe(videoFixture)
  expect(await resolveVideoFile(video({ uri, location }), remote)).toBe(
    path.join(temporary.path, "media", `${sha256}.mp4`),
  )
  // The server's paths follow its own OS, whatever this machine runs.
  const windows = { directory: "D:\\repo" }
  await resolveVideoFile(video({ uri: "file:///D:/repo/clips/a.mp4", location: windows }), remote)
  expect(reads).toEqual([
    { path: "media/video-only.mp4", location },
    { path: "clips/a.mp4", location: windows },
  ])

  for (const item of [
    video({ uri }),
    video({ uri, location: { directory: "/elsewhere" } }),
    video({ uri: "file:///E:/other/c.mp4", location: windows }),
  ])
    await expect(resolveVideoFile(item, remote)).rejects.toThrow()
  await expect(
    resolveVideoFile(video({ uri: "https://example.com/a.mp4" }), { files, localServer: true }),
  ).rejects.toThrow()
})

test("reads a remote server's images through the server and never this machine's files or the network", async () => {
  await using temporary = await tmpdir()
  const files = createMediaFiles(temporary.path)
  const png = new Uint8Array(await Bun.file(imageFixture).arrayBuffer())
  const reads: unknown[] = []
  const readFile = (input: { path: string; location: { directory: string } }) => {
    reads.push(input)
    return Promise.resolve(png)
  }
  const image = (item: Partial<MediaItem>): MediaItem => ({
    id: "image",
    kind: "image",
    mime: "image/png",
    uri: "",
    ...item,
  })
  const local = pathToFileURL(imageFixture).href
  const remote = { files, localServer: false, readFile }

  expect(await resolveImageSource(image({ uri: local }), { files, localServer: true })).toBe(imageFixture)
  expect(await resolveImageSource(image({ uri: "data:image/png;base64,AAAA" }), remote)).toBe(
    "data:image/png;base64,AAAA",
  )
  // A draft whose file is gone still shows from its uri.
  expect(
    await resolveImageSource(
      image({ uri: "data:image/png;base64,AAAA", path: path.join(temporary.path, "gone.png") }),
      remote,
    ),
  ).toBe("data:image/png;base64,AAAA")
  expect(
    await resolveImageSource(image({ uri: local, location: { directory: path.dirname(imageFixture) } }), remote),
  ).toBe(png)
  expect(
    await resolveImageSource(
      image({ uri: "file:///C:/work/out/a%20b.png", location: { directory: "C:\\work" } }),
      remote,
    ),
  ).toBe(png)
  expect(reads).toEqual([
    { path: "image.png", location: { directory: path.dirname(imageFixture) } },
    { path: "out/a b.png", location: { directory: "C:\\work" } },
  ])

  for (const uri of [local, "https://example.com/a.png", "file://host/share/a.png", "file:///etc/passwd"])
    await expect(resolveImageSource(image({ uri, location: { directory: "/work" } }), remote)).rejects.toThrow()
  await expect(
    resolveImageSource(image({ uri: "file://host/share/a.png" }), { files, localServer: true }),
  ).rejects.toThrow()
  expect(reads).toHaveLength(2)
})
