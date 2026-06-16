import { expect, test } from "bun:test"
import { copyCommand, createCopyMethod } from "../src/clipboard"

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

test("propagates native clipboard write failures", async () => {
  const write = createCopyMethod({
    os: "linux",
    wayland: false,
    has: (name) => name === "xclip",
    run: async () => {
      throw new Error("xclip failed")
    },
    loadClipboardy: async () => ({
      default: {
        write: async () => {},
      },
    }),
  })

  await write("hello").then(
    () => {
      throw new Error("expected write to fail")
    },
    (err) => expect(err).toEqual(new Error("xclip failed")),
  )
})

test("propagates clipboardy write failures", async () => {
  const write = createCopyMethod({
    os: "linux",
    wayland: false,
    has: () => false,
    run: async () => Buffer.alloc(0),
    loadClipboardy: async () => ({
      default: {
        write: async () => {
          throw new Error("clipboard unavailable")
        },
      },
    }),
  })

  await write("hello").then(
    () => {
      throw new Error("expected write to fail")
    },
    (err) => expect(err).toEqual(new Error("clipboard unavailable")),
  )
})
