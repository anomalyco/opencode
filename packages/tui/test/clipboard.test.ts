import { expect, test } from "bun:test"
import { copyCommand } from "../src/clipboard"

test("prefers Wayland clipboard when available", () => {
  expect(copyCommand("linux", true, (name) => name === "wl-copy")).toEqual([
    "wl-copy",
    "--type",
    "text/plain;charset=utf-8",
  ])
})

test("uses osascript on macOS", () => {
  expect(copyCommand("darwin", false, (name) => name === "osascript")).toEqual(["osascript"])
})

test("falls back through X11 clipboard commands", () => {
  expect(copyCommand("linux", true, (name) => name === "xclip")).toEqual(["xclip", "-selection", "clipboard"])
  expect(copyCommand("linux", false, (name) => name === "xsel")).toEqual(["xsel", "--clipboard", "--input"])
})

test("returns undefined when native clipboard is unavailable", () => {
  expect(copyCommand("linux", false, () => false)).toBeUndefined()
})

test("supports primary clipboard selection", () => {
  expect(copyCommand("linux", true, (name) => name === "wl-copy", "primary")).toEqual([
    "wl-copy",
    "-p",
    "--type",
    "text/plain;charset=utf-8",
  ])
  expect(copyCommand("linux", false, (name) => name === "xclip", "primary")).toEqual(["xclip", "-selection", "primary"])
  expect(copyCommand("linux", false, (name) => name === "xsel", "primary")).toEqual(["xsel", "--primary", "--input"])
})

test("supports clipboard selection (default)", () => {
  expect(copyCommand("linux", true, (name) => name === "wl-copy", "clipboard")).toEqual([
    "wl-copy",
    "--type",
    "text/plain;charset=utf-8",
  ])
  expect(copyCommand("linux", false, (name) => name === "xclip", "clipboard")).toEqual([
    "xclip",
    "-selection",
    "clipboard",
  ])
  expect(copyCommand("linux", false, (name) => name === "xsel", "clipboard")).toEqual([
    "xsel",
    "--clipboard",
    "--input",
  ])
})
