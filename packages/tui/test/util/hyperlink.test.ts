import { describe, expect, test } from "bun:test"
import { isOpenableHyperlink, openableUrlAt, urlAt, type HyperlinkBuffer } from "../../src/util/hyperlink"

function buffer(options: {
  width: number
  height: number
  attributes: number[]
  links: Record<number, string>
}): HyperlinkBuffer {
  const ids = new Map<number, number>()
  for (const [index, attributes] of options.attributes.entries()) {
    if (attributes) ids.set(attributes, attributes)
  }
  return {
    width: options.width,
    height: options.height,
    buffers: { attributes: options.attributes },
    lib: {
      attributesGetLinkId: (attributes) => ids.get(attributes) ?? 0,
      linkGetUrl: (linkId) => options.links[linkId] ?? "",
    },
  }
}

describe("util.hyperlink", () => {
  test("returns the URL stored on the clicked cell", () => {
    const screen = buffer({
      width: 4,
      height: 1,
      attributes: [0, 7, 7, 0],
      links: { 7: "https://example.com/docs" },
    })
    expect(urlAt(screen, 1, 0)).toBe("https://example.com/docs")
    expect(urlAt(screen, 2, 0)).toBe("https://example.com/docs")
    expect(urlAt(screen, 0, 0)).toBeNull()
  })

  test("rejects out-of-bounds and empty link cells", () => {
    const screen = buffer({
      width: 2,
      height: 1,
      attributes: [3, 0],
      links: { 3: "https://example.com" },
    })
    expect(urlAt(screen, -1, 0)).toBeNull()
    expect(urlAt(screen, 2, 0)).toBeNull()
    expect(urlAt(screen, 0, 1)).toBeNull()
    expect(urlAt(screen, 1.5, 0)).toBeNull()
  })

  test("allows http, https, and mailto and rejects other schemes", () => {
    expect(isOpenableHyperlink("https://example.com")).toBe(true)
    expect(isOpenableHyperlink("http://example.com")).toBe(true)
    expect(isOpenableHyperlink("mailto:a@example.com")).toBe(true)
    expect(isOpenableHyperlink("file:///etc/passwd")).toBe(false)
    expect(isOpenableHyperlink("javascript:alert(1)")).toBe(false)
    expect(isOpenableHyperlink("not a url")).toBe(false)
  })

  test("openableUrlAt ignores cells whose URL is not a safe scheme", () => {
    const screen = buffer({
      width: 1,
      height: 1,
      attributes: [4],
      links: { 4: "file:///tmp/x" },
    })
    expect(urlAt(screen, 0, 0)).toBe("file:///tmp/x")
    expect(openableUrlAt(screen, 0, 0)).toBeNull()
  })
})
