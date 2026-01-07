import { describe, it, expect } from "vitest"
import { detectCommandShell, parseCommand } from "./bash"

describe("Shell Bypass - Unit Tests", () => {
  describe("detectCommandShell", () => {
    it("should detect powershell.exe", () => {
      expect(detectCommandShell("powershell.exe -Command Get-Process")).toBe("powershell")
    })

    it("should detect powershell (without .exe)", () => {
      expect(detectCommandShell("powershell -Command Get-Process")).toBe("powershell")
    })

    it("should detect pwsh", () => {
      expect(detectCommandShell("pwsh -NoProfile -Command Get-Process")).toBe("pwsh")
    })

    it("should detect cmd.exe", () => {
      expect(detectCommandShell("cmd.exe /c echo test")).toBe("cmd")
    })

    it("should detect cmd (without .exe)", () => {
      expect(detectCommandShell("cmd /c echo test")).toBe("cmd")
    })

    it("should detect bash", () => {
      expect(detectCommandShell("bash -c 'echo hello'")).toBe("bash")
    })

    it("should detect /bin/bash", () => {
      expect(detectCommandShell("/bin/bash -c 'echo hello'")).toBe("bash")
    })

    it("should return 'other' for regular commands", () => {
      expect(detectCommandShell("ls -la")).toBe("other")
      expect(detectCommandShell("git status")).toBe("other")
      expect(detectCommandShell("npm install")).toBe("other")
    })
  })

  describe("parseCommand", () => {
    it("should bypass shell for powershell.exe commands", () => {
      const result = parseCommand("powershell.exe -Command Get-Process")
      expect(result.shouldBypassShell).toBe(true)
      expect(result.executable).toBe("powershell.exe")
      expect(result.args).toEqual(["-Command", "Get-Process"])
    })

    it("should bypass shell for pwsh commands", () => {
      const result = parseCommand("pwsh -NoProfile -Command Get-Process")
      expect(result.shouldBypassShell).toBe(true)
      expect(result.executable).toBe("pwsh")
      expect(result.args).toEqual(["-NoProfile", "-Command", "Get-Process"])
    })

    it("should bypass shell for cmd.exe commands (Issue #4 - naive splitting)", () => {
      const result = parseCommand("cmd.exe /c echo hello")
      expect(result.shouldBypassShell).toBe(true)
      expect(result.executable).toBe("cmd.exe")
      // Naive whitespace splitting - "echo hello" becomes ["echo", "hello"]
      expect(result.args).toEqual(["/c", "echo", "hello"])
    })

    it("should bypass shell for cmd commands (without .exe)", () => {
      const result = parseCommand("cmd /c echo hello")
      expect(result.shouldBypassShell).toBe(true)
      expect(result.executable).toBe("cmd")
      expect(result.args).toEqual(["/c", "echo", "hello"])
    })

    it("should NOT bypass for regular bash commands", () => {
      const result = parseCommand("ls -la")
      expect(result.shouldBypassShell).toBe(false)
      expect(result.executable).toBe("ls -la")
      expect(result.args).toEqual([])
    })

    it("should NOT bypass for git commands", () => {
      const result = parseCommand("git status")
      expect(result.shouldBypassShell).toBe(false)
    })

    it("should NOT bypass for npm commands", () => {
      const result = parseCommand("npm install")
      expect(result.shouldBypassShell).toBe(false)
    })

    it("should handle simple PowerShell arguments", () => {
      const result = parseCommand("powershell.exe -NoProfile Get-Process")
      expect(result.shouldBypassShell).toBe(true)
      expect(result.executable).toBe("powershell.exe")
      expect(result.args).toEqual(["-NoProfile", "Get-Process"])
    })
  })
})
