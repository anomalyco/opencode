import { describe, expect, test } from "bun:test"
import path from "path"
import { Widget } from "../src/widget"

describe("widget asset", () => {
  const root = path.join("/tmp", "widget-root")

  test("resolves files inside the widget root", () => {
    expect(Widget.asset(root, "/index.html")).toBe(path.join(root, "index.html"))
    expect(Widget.asset(root, "/assets/app.js")).toBe(path.join(root, "assets", "app.js"))
    expect(Widget.asset(root, "index.html")).toBe(path.join(root, "index.html"))
  })

  test("refuses path traversal outside the root", () => {
    expect(Widget.asset(root, "/../secret.txt")).toBeUndefined()
    expect(Widget.asset(root, "/../../etc/passwd")).toBeUndefined()
    expect(Widget.asset(root, "/a/../../secret")).toBeUndefined()
  })

  test("refuses absolute escapes", () => {
    expect(Widget.asset(root, "/../../../../etc/passwd")).toBeUndefined()
  })
})
