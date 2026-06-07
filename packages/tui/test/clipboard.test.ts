import { expect, test } from "bun:test"
import { clipboardCandidates, copyCommand, writeWithCandidates } from "../src/clipboard"

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

test("builds Linux candidates from display environment", () => {
  const has = (name: string) => ["wl-copy", "xclip", "xsel"].includes(name)

  expect(clipboardCandidates("linux", { WAYLAND_DISPLAY: "wayland-1" }, has).map((candidate) => candidate.method)).toEqual([
    "wl-copy",
    "clipboardy",
    "osc52",
  ])

  expect(clipboardCandidates("linux", { DISPLAY: ":0" }, has).map((candidate) => candidate.method)).toEqual([
    "xclip",
    "xsel",
    "clipboardy",
    "osc52",
  ])

  expect(clipboardCandidates("linux", {}, has).map((candidate) => candidate.method)).toEqual(["clipboardy", "osc52"])
})

test("falls through failed candidates and returns verified native success", async () => {
  const result = await writeWithCandidates(
    "hello",
    [
      { method: "wl-copy", command: "wl-copy", args: [] },
      { method: "xclip", command: "xclip", args: ["-selection", "clipboard"] },
    ],
    async (candidate) => {
      if (candidate.method === "wl-copy") throw new Error("no compositor")
      return { method: candidate.method, verified: true }
    },
  )

  expect(result).toEqual({ method: "xclip", verified: true })
})

test("records all failed clipboard attempts", async () => {
  await expect(
    writeWithCandidates(
      "hello",
      [
        { method: "wl-copy", command: "wl-copy", args: [] },
        { method: "clipboardy" },
      ],
      async (candidate) => {
        throw new Error(`${candidate.method} failed`)
      },
    ),
  ).rejects.toMatchObject({
    name: "ClipboardWriteError",
    attempts: [
      { method: "wl-copy", error: "wl-copy failed" },
      { method: "clipboardy", error: "clipboardy failed" },
    ],
  })
})

test("OSC 52 fallback is marked unverified", async () => {
  const result = await writeWithCandidates("hello", [{ method: "osc52" }], async (candidate) => ({
    method: candidate.method,
    verified: false,
  }))

  expect(result).toEqual({ method: "osc52", verified: false })
})
