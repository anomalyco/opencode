import { describe, expect, test } from "bun:test"
import { PlatformError } from "effect"
import { parseTarget, quote, sshArgs, commandFailureDetail, SshFailure } from "./command"

describe("SSH connection commands", () => {
  test("classifies a missing SSH executable from the platform error", () => {
    // SAFETY: `systemError` takes the reason's tag as data; it has no constructor per tag.
    const error = PlatformError.systemError({
      // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- see SAFETY above
      _tag: "NotFound",
      module: "ChildProcessSpawner",
      method: "spawn",
      pathOrDescriptor: "ssh",
    })

    expect(SshFailure.from(error).code).toBe("ssh-missing")
  })
  test("retains CLI stdout failures without exposing private connection details", () => {
    expect(
      commandFailureDetail(1, {
        stdout:
          'OPENCODE_SSH_REGISTRATION_BEGIN\n{"password":"secret"}\nOPENCODE_SSH_REGISTRATION_END\nFailed to read next file',
        stderr: "",
      }),
    ).toBe("Failed to read next file")
    expect(
      commandFailureDetail(1, {
        stdout: 'OPENCODE_SSH_REGISTRATION_BEGIN\n{"password":"secret"}',
        stderr: "read interrupted",
      }),
    ).toBe("read interrupted")
    expect(commandFailureDetail(255, { stdout: "", stderr: "" })).toBe('{"exitCode":255}')
  })
  test("preserves aliases and connection options without invoking a shell", () => {
    expect(parseTarget('ssh -p 2222 -i "~/.ssh/work key" -J gateway user@devbox')).toEqual({
      host: "user@devbox",
      args: ["-p", "2222", "-i", "~/.ssh/work key", "-J", "gateway"],
    })
    expect(parseTarget("devbox")).toEqual({ host: "devbox", args: [] })
    expect(parseTarget("ssh user@[::1]").host).toBe("user@[::1]")
    expect(sshArgs(parseTarget("devbox"))).toContain("PermitLocalCommand=no")
  })
  test("rejects remote commands, shell syntax, and transport overrides", () => {
    for (const input of [
      "",
      "ssh host whoami",
      "host;whoami",
      "ssh user:password@host",
      "ssh -t host",
      "ssh -o RemoteCommand=whoami host",
      "ssh -L 1234:x:80 host",
      "ssh -p 70000 host",
      'ssh -i "key host',
      "host\nwhoami",
    ]) {
      expect(() => parseTarget(input)).toThrow()
    }

    expect(quote("a'b")).toBe("'a'\\''b'")
  })
})
