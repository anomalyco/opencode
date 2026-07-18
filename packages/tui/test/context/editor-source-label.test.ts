import { expect, test } from "bun:test"
import { editorSourceLabel } from "../../src/context/editor"

test("editorSourceLabel prefers Zed for zed selections", () => {
  expect(editorSourceLabel({ source: "zed", serverName: "ignored" })).toBe("Zed")
})

test("editorSourceLabel uses websocket server name when available", () => {
  expect(editorSourceLabel({ source: "websocket", serverName: "Cursor" })).toBe("Cursor")
  expect(editorSourceLabel({ source: "websocket", serverName: "  VS Code  " })).toBe("VS Code")
})

test("editorSourceLabel falls back to Editor", () => {
  expect(editorSourceLabel({ source: "websocket" })).toBe("Editor")
  expect(editorSourceLabel({})).toBe("Editor")
  expect(editorSourceLabel({ serverName: "   " })).toBe("Editor")
})
