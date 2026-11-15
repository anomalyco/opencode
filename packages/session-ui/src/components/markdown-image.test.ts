import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from "bun:test"
import { createMarkdownImages, localImagePath, localLinkPath } from "./markdown-image"

test.each([
  ["./out/report.html", "./out/report.html"],
  ["docs/guide.md#usage", "docs/guide.md"],
  ["src/app.ts#L42", "src/app.ts#L42"],
  ["src/app.ts#L42-L58", "src/app.ts#L42-L58"],
  ["file:///tmp/demo.mp4", "/tmp/demo.mp4"],
  ["file:///C:/tmp/demo%20clip.mp4", "C:/tmp/demo clip.mp4"],
  ["src/app.ts?plain=1", "src/app.ts"],
  ["app.tsx:42", "app.tsx#L42"],
  ["app.tsx:42-50", "app.tsx#L42-L50"],
  ["foo.ts:0", "foo.ts"],
  ["src\\Makefile:10", "src/Makefile#L10"],
])("recognizes local link %s", (href, path) => {
  expect(localLinkPath(href)).toBe(path)
})

test.each(["#section", "?query", "https://example.com/report.html", "mailto:dev@example.com", "tel:5551234", "", "  "])(
  "keeps non-local link %s",
  (href) => {
    expect(localLinkPath(href)).toBeUndefined()
  },
)

test.each([
  ["C:/tmp/chart.png", "C:/tmp/chart.png"],
  ["C:\\tmp\\chart.png", "C:/tmp/chart.png"],
  ["D:/charts/chart.png", "D:/charts/chart.png"],
  ["Z:\\charts\\chart.png", "Z:/charts/chart.png"],
  ["file:///C:/tmp/chart%20one.png", "C:/tmp/chart one.png"],
  ["file:///d:/charts/chart%20one.png", "d:/charts/chart one.png"],
  ["file:///tmp/chart.png", "/tmp/chart.png"],
  ["file://localhost/tmp/chart.png", "/tmp/chart.png"],
  ["/tmp/chart.png", "/tmp/chart.png"],
  ["./images/chart%20one.svg", "./images/chart one.svg"],
  ["chart.png", "chart.png"],
  ["./chart%25.png", "./chart%.png"],
])("recognizes local image %s", (source, path) => {
  expect(localImagePath(source)).toBe(path)
})

test.each([
  "https://example.com/chart.png",
  "http://example.com/chart.png",
  "//example.com/chart.png",
  "\\\\server\\share\\chart.png",
  "file://server/share/chart.png",
  "data:image/png;base64,AA==",
  "blob:https://example.com/image",
  "javascript:alert(1)",
  "custom:image.png",
  "C:chart.png",
  "chart%00.png",
  "chart%ZZ.png",
  "",
])("does not read non-local or invalid source %s", (source) => {
  expect(localImagePath(source)).toBeUndefined()
})

describe("createMarkdownImages", () => {
  // Happy DOM's fetch cannot read `blob:` URLs; Bun's can, and fails once the URL is revoked.
  const nativeFetch = fetch

  // Lets the read's promise chain settle; fake timers do not drive microtasks.
  const settle = (ticks = 10): Promise<void> =>
    ticks === 0 ? Promise.resolve() : Promise.resolve().then(() => settle(ticks - 1))

  beforeAll(() => GlobalRegistrator.register())

  afterAll(() => GlobalRegistrator.unregister())

  afterEach(() => jest.useRealTimers())

  test("retries a failed read and shows the image without another update", async () => {
    jest.useFakeTimers()
    const reads: string[] = []

    const images = createMarkdownImages(async (path) => {
      reads.push(path)

      if (reads.length === 1) throw new Error("not written yet")

      return new Blob(["png"], { type: "image/png" })
    })

    const root = document.createElement("div")
    root.innerHTML = '<img data-local-image="./out/chart.png" alt="chart">'
    document.body.replaceChildren(root)
    const image = root.querySelector("img")!

    images.update(root)
    await settle()
    expect(image.getAttribute("src")).toBeNull()

    jest.advanceTimersToNextTimer()
    await settle()
    const url = image.getAttribute("src")
    expect(reads).toEqual(["./out/chart.png", "./out/chart.png"])
    expect(url).toStartWith("blob:")
    expect(await nativeFetch(url!).then((response) => response.text())).toBe("png")

    images.dispose()
    await expect(nativeFetch(url!)).rejects.toThrow()
  })
})
