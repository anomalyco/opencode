import { describe, expect, test } from "bun:test"
import { forkCommand, forkKey, tmuxReady } from "../../../src/cli/cmd/tui/util/fork-pane"

describe("fork pane", () => {
  describe("tmuxReady", () => {
    test("returns false when TMUX env is missing", () => {
      expect(tmuxReady({}, "tmux")).toBe(false)
    })

    test("returns false when tmux binary is unavailable", () => {
      expect(tmuxReady({ TMUX: "/tmp/tmux-1000/default,1234,0" }, undefined)).toBe(false)
    })

    test("returns true when inside tmux and tmux binary exists", () => {
      expect(tmuxReady({ TMUX: "/tmp/tmux-1000/default,1234,0" }, "tmux")).toBe(true)
    })
  })

  describe("forkKey", () => {
    test("creates stable session prefill key", () => {
      expect(forkKey("ses_123")).toBe("fork_prefill:ses_123")
    })
  })

  describe("forkCommand", () => {
    test("builds local opencode command for forked session", () => {
      expect(forkCommand({ sessionID: "ses_123" })).toEqual(["opencode", "--session", "ses_123"])
    })

    test("builds attach command with url and dir for remote sessions", () => {
      expect(
        forkCommand({
          sessionID: "ses_123",
          attachURL: "http://example.com:4096",
          dir: "/repo",
        }),
      ).toEqual(["opencode", "attach", "http://example.com:4096", "--session", "ses_123", "--dir", "/repo"])
    })

    test("omits --dir when directory is unavailable", () => {
      expect(
        forkCommand({
          sessionID: "ses_123",
          attachURL: "http://example.com:4096",
        }),
      ).toEqual(["opencode", "attach", "http://example.com:4096", "--session", "ses_123"])
    })
  })
})
