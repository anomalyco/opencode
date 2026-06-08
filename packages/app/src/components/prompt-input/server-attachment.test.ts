import { describe, expect, test } from "bun:test"
import { serverAttachmentFile } from "./server-attachment"

describe("serverAttachmentFile", () => {
  test("creates a file from server text content", async () => {
    const file = serverAttachmentFile("docs/readme.txt", { type: "text", content: "hello", mime: "text/plain" })

    expect(file.name).toBe("readme.txt")
    expect(file.type).toBe("text/plain")
    expect(await file.text()).toBe("hello")
  })

  test("creates a file from server base64 content", async () => {
    const file = serverAttachmentFile("images/pixel.png", {
      type: "binary",
      content: "aGVsbG8=",
      encoding: "base64",
      mime: "image/png",
    })

    expect(file.name).toBe("pixel.png")
    expect(file.type).toBe("image/png")
    expect(await file.text()).toBe("hello")
  })
})
