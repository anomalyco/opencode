import { describe, expect, test } from "bun:test"
import { browseBinaries, parseBrowseStatus } from "./status"

describe("browse status", () => {
  test.each([
    {
      name: "relay not running: no extension state yet",
      json: {
        relay: { running: false },
        setup: { installed: true, mcp: "/Users/me/.config/opencode/opencode.json", agents: [] },
      },
      expected: { installed: true, configured: true, extension: "unknown" },
    },
    {
      name: "connected browser",
      json: { connected: true, pairingState: "connected", relay: {}, setup: { installed: true, mcp: null } },
      expected: { installed: true, configured: false, extension: "connected" },
    },
    {
      name: "relay waiting for the extension, OpenCode set up through its receipt",
      json: {
        connected: false,
        pairingState: "not-seen",
        relay: {},
        setup: { installed: true, mcp: null, agents: [{ name: "opencode", file: "/x" }] },
      },
      expected: { installed: true, configured: true, extension: "not-seen" },
    },
    {
      name: "a pairing state this app doesn't know",
      json: { connected: false, pairingState: "something-new", relay: {}, setup: { installed: true } },
      expected: { installed: true, configured: false, extension: "unknown" },
    },
    {
      name: "a binary nobody ran `browse install` for",
      json: { relay: { running: false }, setup: { installed: false, mcp: null } },
      expected: { installed: false, configured: false, extension: "unknown" },
    },
    { name: "not a status", json: [], expected: { installed: false, configured: false, extension: "unknown" } },
  ])("$name", ({ json, expected }) => {
    expect(parseBrowseStatus(JSON.stringify(json))).toEqual(expected)
  })

  test("looks in the install script's bin first, then bun's, then PATH, without duplicates", () => {
    expect(
      browseBinaries("darwin", "/Users/me", { PATH: "/usr/bin:/Users/me/.local/bin:relative", XDG_BIN_HOME: "" }),
    ).toEqual([
      "/Users/me/.local/bin/browse",
      "/Users/me/.bun/bin/browse",
      "/opt/homebrew/bin/browse",
      "/usr/local/bin/browse",
      "/usr/bin/browse",
    ])

    expect(
      browseBinaries("win32", "C:\\Users\\me", {
        USERPROFILE: "C:\\Users\\me",
        PATH: "C:\\Windows;C:\\Users\\me\\bin",
      }),
    ).toEqual(["C:\\Users\\me\\.local\\bin\\browse.exe", "C:\\Windows\\browse.exe", "C:\\Users\\me\\bin\\browse.exe"])
  })
})
