import { expect, test } from "bun:test"
import { localLinkPath } from "./markdown-image"

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
