import { describe, expect, test } from "bun:test"
import { attachmentMime } from "./attachments"

describe("attachmentMime", () => {
  test("accepts arbitrary binary files", async () => {
    const file = new File([Uint8Array.of(0, 255, 1, 2)], "archive.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })

    expect(await attachmentMime(file)).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
  })

  test("uses octet-stream when the browser has no type", async () => {
    expect(await attachmentMime(new File([Uint8Array.of(0, 1)], "unknown.bin"))).toBe("application/octet-stream")
  })
})
