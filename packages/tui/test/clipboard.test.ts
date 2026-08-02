import { expect, test } from "bun:test"
import { clipboardCommandOptions, copyCommand } from "../src/clipboard"

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

test("hides native clipboard helper windows on Windows", () => {
  expect(clipboardCommandOptions(undefined, "win32")).toEqual({
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  })
  expect(clipboardCommandOptions("copied", "win32")).toEqual({
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  })
})
