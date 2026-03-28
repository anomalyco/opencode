import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Protected } from "../../src/file/protected"
import { SandboxPolicy } from "../../src/sandbox/policy"
import { tmpdir } from "../fixture/fixture"

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

  test("includes /opt/homebrew in default read roots without extra config", () => {
    const out = SandboxPolicy.build({
      cwd: "/tmp/project",
      project_root: "/tmp/project",
      worktree_root: "/tmp/project",
      home: "/Users/tester",
    })

    expect(out.read).toContain("/opt/homebrew")
    expect(out.profile).toContain('(subpath "/opt/homebrew")')
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

  test("resolves workspace protected roots for a standard repo", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".git"), { recursive: true })
      },
    })
    expect(await Protected.resolve(tmp.path, [".git"])).toEqual([path.join(tmp.path, ".git")])
  })

  test("resolves both the gitfile and gitdir for a worktree", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "repo")
    const worktree = path.join(tmp.path, "worktree")
    const gitdir = path.join(root, ".git", "worktrees", "demo")
    await fs.mkdir(gitdir, { recursive: true })
    await fs.mkdir(worktree, { recursive: true })
    await Bun.write(path.join(worktree, ".git"), `gitdir: ../repo/.git/worktrees/demo\n`)

    expect(await Protected.resolve(worktree, [".git"])).toEqual([gitdir, path.join(worktree, ".git")].toSorted())
  })

  test("emits protected-root write denies after write allows", () => {
    const out = SandboxPolicy.build({
      cwd: "/tmp/project/app",
      project_root: "/tmp/project",
      worktree_root: "/tmp/project",
      home: "/Users/tester",
      protected_roots: ["/tmp/project/.git", "/tmp/project/.opencode"],
    })

    const allow = out.profile.indexOf("(allow file-write*")
    const git = out.profile.indexOf('(deny file-write* (subpath "/tmp/project/.git"))')
    const opencode = out.profile.indexOf('(deny file-write* (subpath "/tmp/project/.opencode"))')
    expect(allow).toBeGreaterThanOrEqual(0)
    expect(git).toBeGreaterThan(allow)
    expect(opencode).toBeGreaterThan(allow)
    expect(out.profile).not.toContain('(deny file-read* (subpath "/tmp/project/.git"))')
  })
})
