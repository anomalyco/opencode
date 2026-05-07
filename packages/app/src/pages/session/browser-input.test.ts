import { describe, expect, test } from "bun:test"
import { bytes, keyData, mapPoint, mods, mouseButton, pageUrl } from "./browser-input"

describe("pageUrl", () => {
  test("adds https when missing", () => {
    expect(pageUrl("example.com")).toBe("https://example.com")
  })

  test("keeps existing urls", () => {
    expect(pageUrl("http://example.com")).toBe("http://example.com")
    expect(pageUrl("about:blank")).toBe("about:blank")
  })
})

describe("mouseButton", () => {
  test("maps DOM buttons to CDP names", () => {
    expect(mouseButton(0)).toBe("left")
    expect(mouseButton(1)).toBe("middle")
    expect(mouseButton(2)).toBe("right")
    expect(mouseButton(9)).toBe("none")
  })
})

describe("mods", () => {
  test("packs modifier bits", () => {
    expect(mods({ altKey: true, ctrlKey: false, metaKey: true, shiftKey: true })).toBe(13)
  })
})

describe("keyData", () => {
  test("maps special keys", () => {
    expect(
      keyData(
        {
          altKey: false,
          code: "Enter",
          ctrlKey: false,
          key: "Enter",
          metaKey: false,
          shiftKey: false,
        },
        "keyDown",
      ),
    ).toEqual({
      key: "Enter",
      code: "Enter",
      text: "\r",
      windowsVirtualKeyCode: 13,
      modifiers: 0,
    })
  })

  test("maps printable keys", () => {
    expect(
      keyData(
        {
          altKey: false,
          code: "KeyA",
          ctrlKey: false,
          key: "a",
          metaKey: false,
          shiftKey: false,
        },
        "keyDown",
      ),
    ).toEqual({
      key: "a",
      code: "KeyA",
      text: "a",
      windowsVirtualKeyCode: 97,
      modifiers: 0,
    })
  })
})

describe("mapPoint", () => {
  test("maps client coordinates into viewport coordinates", () => {
    const node = {
      getBoundingClientRect: () => ({
        left: 10,
        top: 20,
        width: 400,
        height: 200,
      }),
    }

    expect(mapPoint(node as never, 800, 400, 210, 120)).toEqual({ x: 400, y: 200 })
  })
})

describe("bytes", () => {
  test("decodes base64", () => {
    expect(Array.from(bytes("QQ=="))).toEqual([65])
  })
})
