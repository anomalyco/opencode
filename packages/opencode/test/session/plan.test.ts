import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import type { InstanceContext } from "../../src/project/instance-context"
import { Session } from "../../src/session/session"

const instance = (vcs: string | undefined, worktree = "/tmp/project") =>
  ({ directory: worktree, worktree, project: { vcs } }) as unknown as InstanceContext

const input = { slug: "test-plan", time: { created: 1700000000000 } }

describe("Session.plan", () => {
  test("defaults to <worktree>/.opencode/plans for git projects", () => {
    const file = Session.plan(input, instance("git"))
    expect(file).toBe(path.join("/tmp/project", ".opencode", "plans", "1700000000000-test-plan.md"))
  })

  test("defaults to the global data dir for non-git projects", () => {
    const file = Session.plan(input, instance(undefined))
    expect(file).toBe(path.join(Global.Path.data, "plans", "1700000000000-test-plan.md"))
  })

  test("honors plans_directory override", () => {
    const file = Session.plan(input, instance("git"), "/custom/plans")
    expect(file).toBe(path.join("/custom/plans", "1700000000000-test-plan.md"))
  })

  test("honors plans_directory override for non-git projects too", () => {
    const file = Session.plan(input, instance(undefined), "/custom/plans")
    expect(file).toBe(path.join("/custom/plans", "1700000000000-test-plan.md"))
  })

  test("expands ~ in plans_directory", () => {
    process.env.OPENCODE_TEST_HOME = "/home/testuser"
    try {
      const file = Session.plan(input, instance("git"), "~/plans")
      expect(file).toBe(path.join("/home/testuser", "plans", "1700000000000-test-plan.md"))
    } finally {
      delete process.env.OPENCODE_TEST_HOME
    }
  })

  test("expands bare ~ in plans_directory", () => {
    process.env.OPENCODE_TEST_HOME = "/home/testuser"
    try {
      const file = Session.plan(input, instance("git"), "~")
      expect(file).toBe(path.join("/home/testuser", "1700000000000-test-plan.md"))
    } finally {
      delete process.env.OPENCODE_TEST_HOME
    }
  })

  test("resolves relative plans_directory to an absolute path", () => {
    const file = Session.plan(input, instance("git"), "relative/plans")
    expect(path.isAbsolute(file)).toBe(true)
    expect(file.endsWith(path.join("relative", "plans", "1700000000000-test-plan.md"))).toBe(true)
  })
})
