import { expect, test } from "bun:test"
import { plan } from "../src/clipboard"

test("SSH sessions only use terminal-mediated copy", () => {
  expect(plan({ os: "linux", ssh: true, tmux: false, wsl: false, display: true, has: () => true })).toEqual(["osc52"])
  expect(plan({ os: "linux", ssh: true, tmux: true, wsl: false, display: true, has: () => true })).toEqual([
    "tmux",
    "osc52",
  ])
})

test("local macOS uses osascript", () => {
  expect(plan({ os: "darwin", ssh: false, tmux: false, wsl: false, display: false, has: () => true })).toEqual([
    "osascript",
  ])
})

test("local Windows/WSL uses powershell before terminal copy", () => {
  expect(plan({ os: "win32", ssh: false, tmux: false, wsl: false, display: false, has: () => true })).toEqual([
    "powershell",
    "osc52",
  ])
  expect(plan({ os: "linux", ssh: false, tmux: false, wsl: true, display: true, has: () => true })).toEqual([
    "powershell",
    "osc52",
  ])
})

test("local Linux prefers the pure-JS X11 owner when DISPLAY is set", () => {
  expect(plan({ os: "linux", ssh: false, tmux: false, wsl: false, display: true, has: () => true })).toEqual([
    "x11",
    "wl-copy",
    "xclip",
    "xsel",
    "osc52",
  ])
})

test("local Linux without DISPLAY and without tools falls back to OSC 52", () => {
  expect(plan({ os: "linux", ssh: false, tmux: false, wsl: false, display: false, has: () => false })).toEqual([
    "osc52",
  ])
})

test("local Linux inside tmux inserts the tmux backend before OSC 52", () => {
  expect(plan({ os: "linux", ssh: false, tmux: true, wsl: false, display: true, has: () => false })).toEqual([
    "x11",
    "tmux",
    "osc52",
  ])
})
