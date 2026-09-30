import { describe, expect, test } from "bun:test"
import { Sandbox } from "../src/permission/sandbox"

const input = {
  shell: "/bin/sh",
  command: "echo hello",
  cwd: "/ws/pkg",
  workspace: "/ws",
  worktree: "/ws",
  network: false,
}

describe("Sandbox.availability", () => {
  test("reports the real mechanism for this platform, with a reason when unavailable", () => {
    const avail = Sandbox.availability()
    if (process.platform === "win32") {
      expect(avail.mechanism).toBe("none")
      expect(typeof avail.reason).toBe("string")
      expect(avail.reason).toContain("Windows")
      return
    }
    expect(["bubblewrap", "seatbelt", "none"]).toContain(avail.mechanism)
    if (avail.mechanism === "none") expect(typeof avail.reason).toBe("string")
    else expect(typeof avail.path).toBe("string")
  })
})

describe("Sandbox.resolve", () => {
  test("restricted-network denies network tools", () => {
    expect(Sandbox.resolve("restricted-network", "webfetch")).toBe("deny")
    expect(Sandbox.resolve("restricted-network", "websearch")).toBe("deny")
    expect(Sandbox.resolve("restricted-network", "browser")).toBe("deny")
  })

  test("restricted-network allows local tools and asks for unknown ones", () => {
    expect(Sandbox.resolve("restricted-network", "read")).toBe("allow")
    expect(Sandbox.resolve("restricted-network", "glob")).toBe("allow")
    expect(Sandbox.resolve("restricted-network", "task")).toBe("ask")
    expect(Sandbox.resolve("restricted-network", "mcp:server:tool")).toBe("ask")
  })

  test("restricted-network on bash follows real availability", () => {
    const expected = Sandbox.availability().mechanism === "none" ? "ask" : "restricted-network"
    expect(Sandbox.resolve("restricted-network", "bash")).toBe(expected)
  })

  test("sandbox is never claimed for in-process tools", () => {
    expect(Sandbox.resolve("sandbox", "read")).toBe("ask")
    expect(Sandbox.resolve("sandbox", "edit")).toBe("ask")
    expect(Sandbox.resolve("sandbox", "webfetch")).toBe("ask")
    expect(Sandbox.resolve("sandbox", "task")).toBe("ask")
  })

  test("sandbox on bash follows real availability", () => {
    const expected = Sandbox.availability().mechanism === "none" ? "ask" : "sandbox"
    expect(Sandbox.resolve("sandbox", "bash")).toBe(expected)
  })
})

describe("Sandbox.wrap", () => {
  test("does not claim a sandbox without a mechanism", () => {
    expect(Sandbox.wrap(input, { mechanism: "none", reason: "no mechanism" })).toBeUndefined()
  })

  test("builds a bubblewrap command with a read-only root and isolated network", () => {
    expect(Sandbox.wrap(input, { mechanism: "bubblewrap", path: "/usr/bin/bwrap" })).toEqual({
      command: "/usr/bin/bwrap",
      args: [
        "--ro-bind",
        "/",
        "/",
        "--bind",
        "/ws",
        "/ws",
        "--tmpfs",
        "/tmp",
        "--dev",
        "/dev",
        "--unshare-net",
        "--die-with-parent",
        "--",
        "/bin/sh",
        "-c",
        "echo hello",
      ],
    })
  })

  test("keeps the network for commands that request it", () => {
    const spawn = Sandbox.wrap({ ...input, network: true }, { mechanism: "bubblewrap", path: "/usr/bin/bwrap" })
    expect(spawn?.args).not.toContain("--unshare-net")
  })

  test("binds the working directory when it sits outside the workspace", () => {
    const spawn = Sandbox.wrap({ ...input, cwd: "/other/place" }, { mechanism: "bubblewrap", path: "/usr/bin/bwrap" })
    expect(spawn?.args.join(" ")).toContain("--bind /other/place /other/place")
  })

  test("builds a seatbelt profile that confines writes and the network", () => {
    const spawn = Sandbox.wrap(input, { mechanism: "seatbelt", path: "/usr/sbin/sandbox-exec" })
    expect(spawn?.command).toBe("/usr/sbin/sandbox-exec")
    const profile = spawn?.args[1] ?? ""
    expect(profile).toContain("(deny file-write*)")
    expect(profile).toContain('(allow file-write* (subpath "/ws"))')
    expect(profile).toContain(`(allow file-write* (subpath "${process.env.TMPDIR ?? "/tmp"}"))`)
    expect(profile).toContain("(deny network*)")
    expect(spawn?.args.slice(2)).toEqual(["/bin/sh", "-c", "echo hello"])
  })

  test("a networked seatbelt profile leaves the network open", () => {
    const spawn = Sandbox.wrap({ ...input, network: true }, { mechanism: "seatbelt", path: "/usr/sbin/sandbox-exec" })
    expect(spawn?.args[1]).not.toContain("(deny network*)")
  })
})
