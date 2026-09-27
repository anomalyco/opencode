import { expect, test } from "bun:test"
import { copyCommand } from "../src/clipboard"

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

test("write rejects instead of reporting a copy when no clipboard backend works", async () => {
  const script = `import { write } from ${JSON.stringify(new URL("../src/clipboard.ts", import.meta.url).href)}
await write("x").then(() => console.log("RESOLVED"), (e) => console.log("REJECTED " + e.message))`
  const env = { ...process.env, PATH: "", DISPLAY: "", WAYLAND_DISPLAY: "" }
  const proc = Bun.spawn([process.execPath, "-e", script], { env, stdout: "pipe", stderr: "ignore", stdin: "ignore" })
  const out = await new Response(proc.stdout).text()
  expect(out).toContain("REJECTED Clipboard copy failed")
})
