import { expect, test, describe } from "bun:test"

describe("Question image handling", () => {
  // Test the extractBase64 function from question.ts
  function extractBase64(url: string): string {
    const comma = url.indexOf(",")
    if (comma === -1) return url
    const body = url.slice(comma + 1)
    if (!body.startsWith("data:")) return body
    return extractBase64(body)
  }

  function dataUrl(url: string, mime: string) {
    if (url.startsWith("data:")) {
      const base64 = extractBase64(url)
      return `data:${mime};base64,${base64}`
    }
    return `data:${mime};base64,${url}`
  }

  // Test the media function from message-v2.ts
  function media(url: string): string {
    if (!url.startsWith("data:")) return url

    const comma = url.indexOf(",")
    if (comma === -1) return url

    const prefix = url.slice(0, comma + 1)
    const body = url.slice(comma + 1)

    if (body.startsWith("data:")) {
      const extracted = media(body)
      if (extracted.startsWith("data:")) {
        const extractedComma = extracted.indexOf(",")
        if (extractedComma !== -1) {
          return prefix + extracted.slice(extractedComma + 1)
        }
      }
      return prefix + extracted
    }

    return prefix + body
  }

  test("handles simple data URL", () => {
    const input = "data:image/png;base64,iVBORw0KGgo="
    const result = dataUrl(input, "image/png")
    expect(result).toBe("data:image/png;base64,iVBORw0KGgo=")
  })

  test("handles nested data URL", () => {
    const nested = "data:image/png;base64,data:image/png;base64,iVBORw0KGgo="
    const result = dataUrl(nested, "image/png")
    expect(result).toBe("data:image/png;base64,iVBORw0KGgo=")
  })

  test("handles deeply nested data URL", () => {
    const deepNested = "data:image/png;base64,data:image/png;base64,data:image/png;base64,iVBORw0KGgo="
    const result = dataUrl(deepNested, "image/png")
    expect(result).toBe("data:image/png;base64,iVBORw0KGgo=")
  })

  test("media function handles simple data URL", () => {
    const input = "data:image/png;base64,iVBORw0KGgo="
    const result = media(input)
    expect(result).toBe("data:image/png;base64,iVBORw0KGgo=")
  })

  test("media function handles nested data URL", () => {
    const nested = "data:image/png;base64,data:image/png;base64,iVBORw0KGgo="
    const result = media(nested)
    expect(result).toBe("data:image/png;base64,iVBORw0KGgo=")
  })

  test("media function handles deeply nested data URL", () => {
    const deepNested = "data:image/png;base64,data:image/png;base64,data:image/png;base64,iVBORw0KGgo="
    const result = media(deepNested)
    expect(result).toBe("data:image/png;base64,iVBORw0KGgo=")
  })

  test("dataUrl and media produce compatible results", () => {
    const nested = "data:image/png;base64,data:image/png;base64,iVBORw0KGgo="
    const dataUrlResult = dataUrl(nested, "image/png")
    const mediaResult = media(dataUrlResult)

    // Both should produce clean, non-nested data URLs
    expect(dataUrlResult).toBe("data:image/png;base64,iVBORw0KGgo=")
    expect(mediaResult).toBe("data:image/png;base64,iVBORw0KGgo=")
  })
})
