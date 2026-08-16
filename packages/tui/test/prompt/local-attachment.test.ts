import { describe, expect, test } from "bun:test"
import { parsePastedFilepaths, readLocalAttachmentWith } from "../../src/component/prompt/local-attachment"
import type { LocalFiles } from "../../src/component/prompt/local-attachment"

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
})
