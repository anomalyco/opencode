import { expect, test } from "bun:test"
import { copyCommand, writeWith, type ClipboardDeps } from "../src/clipboard"

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

function writeDeps(overrides?: Partial<ClipboardDeps>): ClipboardDeps {
  return {
    os: "linux",
    wayland: false,
    has: () => true,
    command: async () => {},
    clipboardy: { write: async () => {} },
    ...overrides,
  }
}

test("rejects when the native clipboard command fails", () => {
  expect(
    writeWith(
      writeDeps({
        command: async () => {
          throw new Error("xclip failed")
        },
      }),
      "hello",
    ),
  ).rejects.toThrow("xclip failed")
})

test("rejects when the clipboardy fallback fails", () => {
  expect(
    writeWith(
      writeDeps({
        has: () => false,
        clipboardy: {
          write: async () => {
            throw new Error("xsel missing")
          },
        },
      }),
      "hello",
    ),
  ).rejects.toThrow("xsel missing")
})

test("resolves when the native clipboard command succeeds", async () => {
  const calls: string[] = []
  await writeWith(
    writeDeps({
      command: async (cmd, args) => {
        calls.push(cmd, ...args)
      },
    }),
    "hello",
  )
  expect(calls[0]).toBe("xclip")
})

test("escapes text for osascript", async () => {
  let received: string | undefined
  await writeWith(
    writeDeps({
      os: "darwin",
      command: async (_, args) => {
        received = args[1]
      },
    }),
    `say "hi"`,
  )
  expect(received).toBe('set the clipboard to "say \\"hi\\""')
})
