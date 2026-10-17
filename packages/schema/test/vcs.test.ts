import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Vcs } from "../src/vcs.js"

test("review base preserves its stable identity and local provenance", () => {
  expect(Vcs.Base.ast.annotations?.identifier).toBe("Vcs.Base")
  const base = { name: "release", ref: "refs/heads/release" }
  for (const source of ["reflog", "default"] as const) {
    expect(Schema.encodeSync(Vcs.Base)(Schema.decodeUnknownSync(Vcs.Base)({ ...base, source }))).toEqual({
      ...base,
      source,
    })
  }
  expect(() => Schema.decodeUnknownSync(Vcs.Base)({ ...base, source: "configured" })).toThrow()
  expect(() => Schema.decodeUnknownSync(Vcs.Base)({ ...base, source: "worktree" })).toThrow()
})

test("review modes preserve shipped working and combined branch names", () => {
  for (const mode of ["working", "branch", "committed"] as const) {
    expect(Schema.decodeUnknownSync(Vcs.Mode)(mode)).toBe(mode)
  }
  expect(() => Schema.decodeUnknownSync(Vcs.Mode)("unknown")).toThrow()
})

test("vcs info decodes optional ahead and behind counts", () => {
  expect(Vcs.Info.ast.annotations?.identifier).toBe("Vcs.Info")
  const parsed = Schema.decodeUnknownSync(Vcs.Info)({
    branch: { current: "dev" },
    ahead: 3,
    behind: 1,
  })
  expect(parsed).toEqual({
    branch: { current: "dev" },
    ahead: 3,
    behind: 1,
  })
})

test("file status decodes optional untracked flag", () => {
  expect(Vcs.FileStatus.ast.annotations?.identifier).toBe("Vcs.FileStatus")
  const parsed = Schema.decodeUnknownSync(Vcs.FileStatus)({
    file: "test.ts",
    additions: 10,
    deletions: 2,
    status: "modified",
    untracked: true,
  })
  expect(parsed.untracked).toBe(true)
})
