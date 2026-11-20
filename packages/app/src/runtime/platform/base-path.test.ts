import { afterEach, expect, test } from "bun:test"
import { basePath } from "./base-path"

afterEach(() => document.head.querySelector('meta[name="opencode-base-path"]')?.remove())

test("reads the base path the server injects into the page", () => {
  expect(basePath()).toBe("")

  const meta = document.createElement("meta")
  meta.name = "opencode-base-path"
  meta.content = "/opencode"
  document.head.append(meta)

  expect(basePath()).toBe("/opencode")
})
