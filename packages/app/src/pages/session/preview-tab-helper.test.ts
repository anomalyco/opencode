import { afterEach, describe, expect, test } from "bun:test"
import { base64ToBytes, blobUrlFromBase64 } from "./preview-tab-helper"

const originalCreateObjectURL = URL.createObjectURL

describe("base64ToBytes", () => {
  test("decodes base64 into bytes", () => {
    const result = base64ToBytes("SGVsbG8=")

    expect(result).toEqual(new Uint8Array([72, 101, 108, 108, 111]))
  })

  test("returns undefined for invalid base64", () => {
    expect(base64ToBytes("%%not-base64%%")).toBeUndefined()
  })
})

describe("blobUrlFromBase64", () => {
  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
  })

  test("creates a blob URL for valid base64 content", async () => {
    let received: Blob | undefined
    URL.createObjectURL = ((blob: Blob) => {
      received = blob
      return "blob:pdf-preview"
    }) as typeof URL.createObjectURL

    const result = blobUrlFromBase64("SGVsbG8=", "application/pdf")

    expect(result).toBe("blob:pdf-preview")
    expect(received).toBeInstanceOf(Blob)
    expect(received?.type).toBe("application/pdf")
    expect(new Uint8Array(await received!.arrayBuffer())).toEqual(new Uint8Array([72, 101, 108, 108, 111]))
  })

  test("returns undefined when base64 content is invalid", () => {
    expect(blobUrlFromBase64("%%not-base64%%", "application/pdf")).toBeUndefined()
  })
})
