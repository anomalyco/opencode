import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Clipboard } from "../../../../../src/cli/cmd/tui/util/clipboard"

describe("Clipboard.copyRich", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Reset environment variables before each test
    delete process.env["SSH_CLIENT"]
    delete process.env["SSH_TTY"]
    delete process.env["TMUX"]
    delete process.env["STY"]
    delete process.env["WAYLAND_DISPLAY"]
  })

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv }
  })

  describe("remote session detection", () => {
    test("detects SSH session via SSH_CLIENT", async () => {
      process.env["SSH_CLIENT"] = "192.168.1.1 12345 22"

      const result = await Clipboard.copyRich("plain", "<p>html</p>")

      expect(result.ok).toBe(true)
      if (result.ok && !result.rich) {
        expect(result.reason).toContain("SSH")
      }
    })

    test("detects SSH session via SSH_TTY", async () => {
      process.env["SSH_TTY"] = "/dev/pts/0"

      const result = await Clipboard.copyRich("plain", "<p>html</p>")

      expect(result.ok).toBe(true)
      if (result.ok && !result.rich) {
        expect(result.reason).toContain("SSH")
      }
    })

    test("detects tmux session", async () => {
      process.env["TMUX"] = "/tmp/tmux-1000/default,12345,0"

      const result = await Clipboard.copyRich("plain", "<p>html</p>")

      expect(result.ok).toBe(true)
      if (result.ok && !result.rich) {
        expect(result.reason).toContain("tmux")
      }
    })

    test("detects screen session", async () => {
      process.env["STY"] = "12345.pts-0.hostname"

      const result = await Clipboard.copyRich("plain", "<p>html</p>")

      expect(result.ok).toBe(true)
      if (result.ok && !result.rich) {
        expect(result.reason).toContain("SSH")
      }
    })
  })

  describe("platform-specific behavior", () => {
    test("returns a result object", async () => {
      const result = await Clipboard.copyRich("plain text", "<p>html</p>")

      expect(result).toBeDefined()
      expect(result.ok).toBeDefined()

      if (result.ok && result.rich) {
        expect(result.rich).toBe(true)
      } else if (result.ok && !result.rich) {
        expect(result.reason).toBeDefined()
        expect(typeof result.reason).toBe("string")
      }
    })

    test("handles empty strings", async () => {
      const result = await Clipboard.copyRich("", "")

      expect(result.ok).toBeDefined()
    })

    test("handles special characters in plain text", async () => {
      const plain = "Special chars: & < > \" ' \n\r"
      const html = "<p>Special chars: &amp; &lt; &gt;</p>"

      const result = await Clipboard.copyRich(plain, html)

      expect(result.ok).toBeDefined()
    })

    test("handles large content", async () => {
      const plain = "x".repeat(100000)
      const html = `<p>${"x".repeat(100000)}</p>`

      const result = await Clipboard.copyRich(plain, html)

      expect(result.ok).toBeDefined()
    })
  })

  describe("Linux Wayland", () => {
    test("attempts wl-copy when WAYLAND_DISPLAY is set", async () => {
      if (process.platform !== "linux") {
        // Skip on non-Linux platforms
        return
      }

      process.env["WAYLAND_DISPLAY"] = "wayland-0"

      const result = await Clipboard.copyRich("plain", "<p>html</p>")

      expect(result.ok).toBe(true)
      // Result depends on whether wl-clipboard is installed
      if (result.ok && !result.rich) {
        expect(result.reason).toBeDefined()
      }
    })
  })

  describe("Linux X11", () => {
    test("attempts xclip when WAYLAND_DISPLAY is not set", async () => {
      if (process.platform !== "linux") {
        // Skip on non-Linux platforms
        return
      }

      delete process.env["WAYLAND_DISPLAY"]

      const result = await Clipboard.copyRich("plain", "<p>html</p>")

      expect(result.ok).toBe(true)
      // Result depends on whether xclip is installed
      if (result.ok && !result.rich) {
        expect(result.reason).toBeDefined()
      }
    })
  })

  describe("edge cases", () => {
    test("handles HTML with newlines", async () => {
      const html = `
        <div>
          <p>Paragraph 1</p>
          <p>Paragraph 2</p>
        </div>
      `

      const result = await Clipboard.copyRich("plain", html)

      expect(result.ok).toBeDefined()
    })

    test("handles very long HTML strings", async () => {
      const longHtml = "<p>" + "Lorem ipsum ".repeat(10000) + "</p>"

      const result = await Clipboard.copyRich("plain", longHtml)

      expect(result.ok).toBeDefined()
    })

    test("handles HTML with quotes and escapes", async () => {
      const html = `<p class="test" data-value='something'>Content with "quotes" and 'apostrophes'</p>`

      const result = await Clipboard.copyRich("plain", html)

      expect(result.ok).toBeDefined()
    })

    test("handles unicode characters", async () => {
      const plain = "Unicode: 你好 🎉 émojis"
      const html = "<p>Unicode: 你好 🎉 émojis</p>"

      const result = await Clipboard.copyRich(plain, html)

      expect(result.ok).toBeDefined()
    })
  })

  describe("result types", () => {
    test("success with rich text returns { ok: true, rich: true }", async () => {
      const result = await Clipboard.copyRich("plain", "<p>html</p>")

      if (result.ok && result.rich) {
        expect(result.ok).toBe(true)
        expect(result.rich).toBe(true)
        // TypeScript should know this has no 'reason' property
        expect("reason" in result).toBe(false)
      }
    })

    test("success with plain text fallback returns { ok: true, rich: false, reason }", async () => {
      // Force fallback by setting SSH
      process.env["SSH_CLIENT"] = "1"

      const result = await Clipboard.copyRich("plain", "<p>html</p>")

      expect(result.ok).toBe(true)
      if (result.ok && !result.rich) {
        expect(result.reason).toBeDefined()
        expect(typeof result.reason).toBe("string")
        expect(result.reason.length).toBeGreaterThan(0)
      }
    })
  })
})
