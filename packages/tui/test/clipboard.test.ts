import { expect, test } from "bun:test"
import { copyCommand, readPrimaryCommand } from "../src/clipboard"

test("prefers Wayland clipboard when available", () => {
  expect(copyCommand("linux", true, (name) => name === "wl-copy")).toEqual(["wl-copy"])
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

test("reads primary selection with Wayland tooling when available", () => {
  expect(readPrimaryCommand("linux", true, (name) => name === "wl-paste")).toEqual(["wl-paste", "--primary", "--no-newline"])
})

test("falls back through X11 primary selection commands", () => {
  expect(readPrimaryCommand("linux", false, (name) => name === "xclip")).toEqual(["xclip", "-selection", "primary", "-o"])
  expect(readPrimaryCommand("linux", false, (name) => name === "xsel")).toEqual(["xsel", "--primary", "--output"])
})

test("returns undefined for primary selection on non-Linux platforms", () => {
  expect(readPrimaryCommand("darwin", true, () => true)).toBeUndefined()
  expect(readPrimaryCommand("win32", true, () => true)).toBeUndefined()
})
