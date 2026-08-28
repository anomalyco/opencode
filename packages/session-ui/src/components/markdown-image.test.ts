import { expect, test } from "bun:test"
import { localImagePath } from "./markdown-image"

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
