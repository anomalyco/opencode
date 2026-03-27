import { describe, expect, test } from "bun:test"
import path from "path"
import { SandboxPolicy } from "../../src/sandbox/policy"

describe("sandbox.policy", () => {
  test("builds a deny-by-default profile with explicit roots", () => {
    const out = SandboxPolicy.build({
      cwd: "/tmp/project/app",
      project_root: "/tmp/project",
      worktree_root: "/tmp/project",
      home: "/Users/tester",
      extra_read_roots: ["/opt/homebrew"],
      extra_write_roots: ["/tmp/project/tmp"],
      extra_deny_paths: ["/tmp/blocked"],
    })

    expect(out.profile).toContain("(deny default)")
    expect(out.profile).toContain("(allow file-read*")
    expect(out.profile).toContain("(allow file-write*")
    expect(out.profile).not.toContain("(allow network*)")
    expect(out.profile).not.toContain("AF_UNIX")
    expect(out.read).toContain("/tmp/project")
    expect(out.read).toContain("/opt/homebrew")
    expect(out.write).toContain("/tmp/project/tmp")
    expect(out.deny).toContain(path.join("/Users/tester", ".ssh"))
    expect(out.deny).toContain("/tmp/blocked")
  })

  test("adds network and unix socket rules only when requested", () => {
    const out = SandboxPolicy.build({
      cwd: "/tmp/project",
      project_root: "/tmp/project",
      worktree_root: "/tmp/project",
      home: "/Users/tester",
      allow_network: true,
      allow_unix_sockets: true,
    })

    expect(out.profile).toContain("(allow network*)")
    expect(out.profile).toContain("AF_UNIX")
    expect(out.profile).toContain("network-bind")
    expect(out.profile).toContain("network-outbound")
  })

  test("supports read-only mode without project write roots", () => {
    const out = SandboxPolicy.build({
      cwd: "/tmp/project/app",
      project_root: "/tmp/project",
      worktree_root: "/tmp/project",
      home: "/Users/tester",
      mode: "read-only",
      extra_write_roots: ["/tmp/project/tmp"],
    })

    expect(out.read).toContain("/tmp/project")
    expect(out.write).toEqual(["/private/tmp", "/tmp", "/tmp/project/tmp"])
    expect(out.profile).not.toContain('(allow file-write*\n  (subpath "/tmp/project")')
  })
})
