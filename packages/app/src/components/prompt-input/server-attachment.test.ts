import { describe, expect, test } from "bun:test"
import { serverAttachmentFile } from "./server-attachment"

describe("serverAttachmentFile", () => {
  test("creates a file from server text content", async () => {
    const file = serverAttachmentFile("docs/readme.txt", {
      uri: "file:///docs/readme.txt",
      name: "readme.txt",
      content: "hello",
      encoding: "utf8",
      mime: "text/plain",
    })

    expect(file.name).toBe("readme.txt")
    expect(file.type).toBe("text/plain")
    expect(await file.text()).toBe("hello")
  })

  test("creates a file from server base64 content", async () => {
    const file = serverAttachmentFile("images/pixel.png", {
      uri: "file:///images/pixel.png",
      name: "pixel.png",
      content: "aGVsbG8=",
      encoding: "base64",
      mime: "image/png",
    })

    expect(file.name).toBe("pixel.png")
    expect(file.type).toBe("image/png")
    expect(await file.text()).toBe("hello")
  })
})
