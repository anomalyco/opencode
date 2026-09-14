import { describe, expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  MAX_LOCAL_ATTACHMENT_BYTES,
  parsePastedFilepaths,
  readLocalAttachmentWith,
  resolvePastedAttachments,
} from "../../src/component/prompt/local-attachment"
import type { LocalFiles } from "../../src/component/prompt/local-attachment"
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
        { type: "file", uri: "data:image/png;base64,AQID", filename: "one image.png" },
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
        { type: "file", uri: "data:image/png;base64,AQID", filename: "one image.png" },
        { type: "file", uri: "data:application/pdf;base64,BAUG", filename: "two file.pdf" },
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

  test("bounds the number of resolved paths", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "image.png")
    await Bun.write(file, new Uint8Array([1]))

    expect(await resolvePastedAttachments(Array(32).fill(file).join(" "), process.platform)).toHaveLength(32)
    expect(await resolvePastedAttachments(Array(33).fill(file).join(" "), process.platform)).toBeUndefined()
  })
})
