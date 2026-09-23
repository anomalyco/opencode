import { describe, expect, test } from "bun:test"
import { boundToastDescription, toastDescriptionLimit } from "./description"

describe("toast description bound", () => {
  test("keeps ordinary descriptions and the options object", () => {
    const options = { title: "Failed", description: "Attachment exceeds the limit" }
    expect(boundToastDescription(options)).toBe(options)
    expect(boundToastDescription({ description: undefined })).toEqual({ description: undefined })
  })

  test("cuts a description that embeds a whole data URL", () => {
    const description = `Attachment exceeds the limit: data:text/plain;base64,${"Q".repeat(50 * 1024 * 1024)}`
    const bounded = boundToastDescription({ title: "Failed to send prompt", description })
    expect(bounded.description!.length).toBe(toastDescriptionLimit + 1)
    expect(bounded.description!.endsWith("…")).toBe(true)
    expect(bounded.description!.startsWith("Attachment exceeds the limit: data:text/plain;base64,")).toBe(true)
    expect(bounded.title).toBe("Failed to send prompt")
  })
})

