import { describe, expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  MAX_LOCAL_ATTACHMENT_BYTES,
  MAX_LOCAL_VIDEO_BYTES,
  parsePastedFilepaths,
  promptFilesForServer,
  readKeptAttachments,
  readLocalAttachmentWith,
  resolvePastedAttachments,
  oversizedPastedVideo,
} from "../../src/component/prompt/local-attachment"
import type { LocalFiles } from "../../src/component/prompt/local-attachment"
import type { PromptFile } from "../../src/prompt/history"
import { tmpdir } from "../fixture/fixture"

function files(input: { mime: string; text?: string; bytes?: Uint8Array }): LocalFiles {
  return {
    mime: async () => input.mime,
    readText: async () => input.text ?? "",
    readBytes: async () => input.bytes ?? new Uint8Array(),
  }
}

describe("prompt local attachments", () => {
  test("parses multi-file drops from POSIX, URI-list, and Windows terminals", () => {
    expect(parsePastedFilepaths("'/tmp/one image.png' /tmp/two\\ image.webp", "linux")).toEqual([
      "/tmp/one image.png",
      "/tmp/two image.webp",
    ])
    expect(parsePastedFilepaths("file:///tmp/one%20image.png\r\nfile:///tmp/two.webp", "linux")).toEqual([
      "/tmp/one image.png",
      "/tmp/two.webp",
    ])
    expect(parsePastedFilepaths("# dropped files\nfile:///tmp/one.png\nfile:///tmp/two.webp", "linux")).toEqual([
      "/tmp/one.png",
      "/tmp/two.webp",
    ])
    expect(parsePastedFilepaths("/tmp/one\\\\image.png /tmp/two.webp", "linux")).toEqual([
      "/tmp/one\\image.png",
      "/tmp/two.webp",
    ])
    expect(parsePastedFilepaths('"C:\\one image.png" "C:\\two.webp"', "win32")).toEqual([
      "C:\\one image.png",
      "C:\\two.webp",
    ])
    expect(parsePastedFilepaths("file:///C:/one%20image.png\r\nfile://server/share/two.webp", "win32")).toEqual([
      "C:\\one image.png",
      "\\\\server\\share\\two.webp",
    ])
    expect(parsePastedFilepaths('"/tmp/O\'Brien.png" /tmp/two.webp', "linux")).toEqual([
      "/tmp/O'Brien.png",
      "/tmp/two.webp",
    ])
  })

  test("rejects unbounded and malformed multi-file drops", () => {
    expect(parsePastedFilepaths("'/tmp/one.png /tmp/two.png", "linux")).toEqual([])
    expect(
      parsePastedFilepaths(Array.from({ length: 33 }, (_, index) => `/tmp/${index}.png`).join(" "), "linux"),
    ).toEqual([])
  })

  test("reads SVG attachments as text", async () => {
    expect(await readLocalAttachmentWith(files({ mime: "image/svg+xml", text: "<svg />" }), "/tmp/image.svg")).toEqual({
      type: "text",
      mime: "image/svg+xml",
      content: "<svg />",
    })
  })

  test("reads image and PDF attachments as bytes", async () => {
    const content = new Uint8Array([1, 2, 3])
    expect(await readLocalAttachmentWith(files({ mime: "application/pdf", bytes: content }), "/tmp/file.pdf")).toEqual({
      type: "binary",
      mime: "application/pdf",
      content,
    })
  })

  test("ignores unsupported and unreadable local files", async () => {
    expect(await readLocalAttachmentWith(files({ mime: "text/plain" }), "/tmp/file.txt")).toBeUndefined()
    expect(
      await readLocalAttachmentWith(
        {
          ...files({ mime: "image/png" }),
          readBytes: async () => Promise.reject(new Error("missing")),
        },
        "/tmp/missing.png",
      ),
    ).toBeUndefined()
    expect(
      await readLocalAttachmentWith(files({ mime: "image/png", bytes: new Uint8Array(2) }), "/tmp/large.png", 1),
    ).toBeUndefined()
  })

  test("resolves a single image path before splitting spaces", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "one image.png")
    await Bun.write(file, new Uint8Array([1, 2, 3]))

    for (const input of [file, `'${file}'`, pathToFileURL(file).href]) {
      expect(await resolvePastedAttachments(input, process.platform)).toEqual([
        { type: "file", uri: "data:image/png;base64,AQID", filename: "one image.png", path: file },
      ])
    }
  })

  test("resolves quoted paths and URI lists as ordered attachments", async () => {
    await using tmp = await tmpdir()
    const image = path.join(tmp.path, "one image.png")
    const pdf = path.join(tmp.path, "two file.pdf")
    await Promise.all([Bun.write(image, new Uint8Array([1, 2, 3])), Bun.write(pdf, new Uint8Array([4, 5, 6]))])

    for (const input of [
      `'${image}' "${pdf}"`,
      `# dropped files\r\n${pathToFileURL(image).href}\r\n${pathToFileURL(pdf).href}`,
    ]) {
      expect(await resolvePastedAttachments(input, process.platform)).toEqual([
        { type: "file", uri: "data:image/png;base64,AQID", filename: "one image.png", path: image },
        { type: "file", uri: "data:application/pdf;base64,BAUG", filename: "two file.pdf", path: pdf },
      ])
    }
  })

  test("falls back to plain text for unsupported or incomplete drops", async () => {
    await using tmp = await tmpdir()
    const image = path.join(tmp.path, "image.png")
    const text = path.join(tmp.path, "notes.txt")
    await Promise.all([Bun.write(image, new Uint8Array([1])), Bun.write(text, "notes")])

    for (const input of [
      "",
      "plain\r\ntext",
      "https://example.com/image.png",
      text,
      `${image} ${text}`,
      `${image} ${path.join(tmp.path, "missing.png")}`,
    ]) {
      expect(await resolvePastedAttachments(input, process.platform)).toBeUndefined()
    }
  })

  test("resolves SVG files as text with the original content", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "image.svg")
    const content = "<svg />\r\n"
    await Bun.write(file, content)

    expect(await resolvePastedAttachments(file, process.platform)).toEqual([
      { type: "text", content, filename: "image.svg" },
    ])
  })

  test("shares the byte budget across binary and SVG attachments", async () => {
    await using tmp = await tmpdir()
    const image = path.join(tmp.path, "image.png")
    const svg = path.join(tmp.path, "image.svg")
    const content = "<svg>\u00e9</svg>"
    await Promise.all([
      Bun.write(image, new Uint8Array(MAX_LOCAL_ATTACHMENT_BYTES - Buffer.byteLength(content))),
      Bun.write(svg, content),
    ])

    expect(await resolvePastedAttachments(`${image} ${svg}`, process.platform)).toMatchObject([
      { type: "file", filename: "image.png" },
      { type: "text", content, filename: "image.svg" },
    ])
    await Bun.write(svg, content + " ")
    expect(await resolvePastedAttachments(`${image} ${svg}`, process.platform)).toBeUndefined()

    await Bun.write(image, new Uint8Array(MAX_LOCAL_ATTACHMENT_BYTES + 1))
    expect(await resolvePastedAttachments(image, process.platform)).toBeUndefined()
  })

  // A larger one pastes as text, below.
  test("pastes MP4, MOV, and M4V paths as videos only when asked, up to core's cap", async () => {
    await using tmp = await tmpdir()
    const clips = ["clip.mp4", "clip.MOV", "clip.m4v", "capped.mp4"].map((name) => path.join(tmp.path, name))
    await Promise.all(
      clips.map((clip) => Bun.write(clip, new Uint8Array(clip.includes("capped") ? MAX_LOCAL_VIDEO_BYTES : 3))),
    )

    // Pasting keeps only the path; sending reads the file.
    const file = (clip: string) => ({
      type: "file" as const,
      uri: pathToFileURL(clip).href,
      filename: path.basename(clip),
      path: clip,
    })
    expect(await resolvePastedAttachments(clips.join(" "), process.platform, true)).toEqual(clips.map(file))
    expect(await resolvePastedAttachments(clips[0]!, process.platform)).toBeUndefined()
  })

  // A restored video is kept under a content hash, over the paste cap; its name is the one the user knows.
  test("reads kept files again as their type, up to the attachment limit, and names the ones it leaves out", async () => {
    await using tmp = await tmpdir()
    const types = { "clip.mp4": "video/mp4", "clip.mkv": "video/x-matroska", "clip.qt": "video/quicktime" }
    const small = Object.keys(types).map((name) => path.join(tmp.path, name))
    const restored = path.join(tmp.path, "0f".repeat(32) + ".mp4")
    const large = path.join(tmp.path, "large.mp4")
    await Promise.all([
      ...small.map((file) => Bun.write(file, new Uint8Array([1, 2, 3]))),
      Bun.write(restored, new Uint8Array(MAX_LOCAL_VIDEO_BYTES + 1)),
      Bun.write(large, new Uint8Array(MAX_LOCAL_ATTACHMENT_BYTES + 1)),
    ])
    const kept = (file: string, name?: string) => ({ uri: pathToFileURL(file).href, path: file, name })
    const image = { uri: "data:image/png;base64,AAAA", path: path.join(tmp.path, "missing.png") }
    const gone = path.join(tmp.path, "gone.mov")

    const result = await readKeptAttachments(
      [image, ...small.map((file) => kept(file)), kept(restored, "clip.mp4"), kept(large, "big clip.mp4"), kept(gone)],
      true,
      "",
    )
    expect(result.files.map((file) => file.uri.split(",")[0])).toEqual([
      "data:image/png;base64",
      ...Object.values(types).map((mime) => `data:${mime};base64`),
      "data:video/mp4;base64",
    ])
    expect(result.files[1]).toEqual({ ...kept(small[0]!), uri: "data:video/mp4;base64,AQID" })
    expect(result.files.at(-1)).toMatchObject({ name: "clip.mp4" })
    expect(result.unreadable).toEqual(["big clip.mp4", "gone.mov"])
  })

  test("never sends a remote server a file uri history or the stash recalled without a path from another server", async () => {
    await using tmp = await tmpdir()
    const clip = path.join(tmp.path, "clip.webm")
    await Bun.write(clip, new Uint8Array([1, 2, 3]))
    const restored = {
      uri: pathToFileURL(clip).href,
      name: "clip.webm",
      mention: { start: 0, end: 9, text: "[Video 1]" },
    }
    const recalled = { ...restored, server: "https://devbox.example" }

    // A local server reads a recalled file itself; any server reads the file its own restore names.
    expect(await readKeptAttachments([recalled, restored], true, "")).toEqual({
      files: [recalled, restored],
      unreadable: [],
    })
    expect(await readKeptAttachments([recalled, restored], false, "https://other.example")).toEqual({
      files: [restored],
      unreadable: ["clip.webm"],
    })
    expect(promptFilesForServer([recalled], false, tmp.path)).toEqual([restored])
    // With its path, the file is sent as the bytes read here, to either server.
    const localized = { ...restored, path: clip }
    for (const localServer of [true, false])
      expect((await readKeptAttachments([localized], localServer, "")).files).toEqual([
        { ...localized, uri: "data:video/webm;base64,AQID" },
      ])
  })

  test("names the video that takes a paste of attachable files over the limit, and pastes it as text", async () => {
    await using tmp = await tmpdir()
    const image = path.join(tmp.path, "shot.png")
    const clip = path.join(tmp.path, "my clip.mp4")
    const large = path.join(tmp.path, "large.mp4")
    // The video fits core's cap, and with the image it is one byte over the shared limit. The large one is over the cap.
    await Promise.all([
      Bun.write(image, new Uint8Array(MAX_LOCAL_ATTACHMENT_BYTES - MAX_LOCAL_VIDEO_BYTES + 1)),
      Bun.write(clip, new Uint8Array(MAX_LOCAL_VIDEO_BYTES)),
      Bun.write(large, new Uint8Array(MAX_LOCAL_VIDEO_BYTES + 1)),
    ])
    const long = `${"a".repeat(8192)}.mp4`
    for (const [text, oversized] of [
      [large, large],
      [`'${large}'`, large],
      [`${image} '${clip}'`, clip],
      // The image crosses the limit, not the video.
      [`'${clip}' ${image}`, undefined],
      // Prose, and names the filesystem rejects, are not attachments.
      [`${image} '${clip}' is too big`, undefined],
      [`see ${image} '${clip}'`, undefined],
      [long, undefined],
      [`${long} ${long}`, undefined],
      ["clip\0.mp4 b.mp4", undefined],
    ]) {
      expect(await resolvePastedAttachments(text!, process.platform, true)).toBeUndefined()
      expect(await oversizedPastedVideo(text!, process.platform)).toBe(oversized)
    }
  })

  test("bounds the number of resolved paths", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "image.png")
    await Bun.write(file, new Uint8Array([1]))

    expect(await resolvePastedAttachments(Array(32).fill(file).join(" "), process.platform)).toHaveLength(32)
    expect(await resolvePastedAttachments(Array(33).fill(file).join(" "), process.platform)).toBeUndefined()
  })

  test("keeps pasted bytes with source paths only for a local server", async () => {
    await using tmp = await tmpdir()
    const image = path.join(tmp.path, "scrëen shot.png")
    const photo = path.join(tmp.path, "photo.jpg")
    const pdf = path.join(tmp.path, "report.pdf")
    await Promise.all([
      Bun.write(image, new Uint8Array([1, 2, 3])),
      Bun.write(photo, new Uint8Array([7, 8, 9])),
      Bun.write(pdf, new Uint8Array([4, 5, 6])),
    ])
    const pasted = await resolvePastedAttachments(`'${image}' ${photo} "${pdf}"`, process.platform)
    if (!pasted) throw new Error("expected attachments")
    const files: PromptFile[] = [
      ...pasted.map((file, index) => ({
        uri: file.uri ?? "",
        name: file.filename,
        path: file.path,
        mention: { start: index * 10, end: index * 10 + 9, text: `[Image ${index + 1}]` },
      })),
      { uri: "data:image/png;base64,Cg==", name: "clipboard" },
    ]

    const mentions = files.map((file) => file.mention)
    const kept = path.join(tmp.path, "prompt-media")

    await Bun.write(image, new Uint8Array([10, 11, 12]))
    expect(promptFilesForServer(files, true, kept)).toEqual([
      {
        uri: "data:image/png;base64,AQID",
        source: { type: "uri", uri: pathToFileURL(image).href },
        name: "scrëen shot.png",
        mention: mentions[0],
      },
      {
        uri: "data:image/jpeg;base64,BwgJ",
        source: { type: "uri", uri: pathToFileURL(photo).href },
        name: "photo.jpg",
        mention: mentions[1],
      },
      {
        uri: "data:application/pdf;base64,BAUG",
        source: { type: "uri", uri: pathToFileURL(pdf).href },
        name: "report.pdf",
        mention: mentions[2],
      },
      { uri: "data:image/png;base64,Cg==", name: "clipboard" },
    ])
    expect(promptFilesForServer(files, false, kept)).toEqual([
      { uri: "data:image/png;base64,AQID", name: "scrëen shot.png", mention: mentions[0] },
      { uri: "data:image/jpeg;base64,BwgJ", name: "photo.jpg", mention: mentions[1] },
      { uri: "data:application/pdf;base64,BAUG", name: "report.pdf", mention: mentions[2] },
      { uri: "data:image/png;base64,Cg==", name: "clipboard" },
    ])

    await Bun.file(image).delete()
    expect(promptFilesForServer(files, true, kept)?.[0]).toEqual({
      uri: "data:image/png;base64,AQID",
      source: { type: "uri", uri: pathToFileURL(image).href },
      name: "scrëen shot.png",
      mention: mentions[0],
    })

    // The TUI's own copy of a restored video is no source the model should hear about.
    const restored = { uri: "data:video/mp4;base64,AQID", name: "clip.mp4", path: path.join(kept, "0f.mp4") }
    expect(promptFilesForServer([restored], true, kept)).toEqual([{ uri: restored.uri, name: "clip.mp4" }])
  })
})
