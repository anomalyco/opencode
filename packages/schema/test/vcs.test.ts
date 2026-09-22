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

test("commit graph keeps stable identities and distinguishes ref namespaces", () => {
  expect(Vcs.GraphRef.ast.annotations?.identifier).toBe("Vcs.GraphRef")
  expect(Vcs.GraphCommit.ast.annotations?.identifier).toBe("Vcs.GraphCommit")
  expect(Vcs.GraphPage.ast.annotations?.identifier).toBe("Vcs.GraphPage")
  for (const kind of ["branch", "remote", "tag", "head"] as const) {
    expect(Schema.decodeUnknownSync(Vcs.GraphRef)({ name: "main", kind })).toEqual({ name: "main", kind })
  }
  expect(() => Schema.decodeUnknownSync(Vcs.GraphRef)({ name: "main", kind: "checkpoint" })).toThrow()
})

test("commit graph carries nullable author metadata and pre-epoch timestamps", () => {
  const commit = {
    hash: "a".repeat(40),
    parents: [],
    refs: [{ name: "v1.0", kind: "tag" as const }],
    subject: "初始提交",
    authorName: null,
    authoredAtMs: -2_208_988_800_000,
  }
  expect(Schema.encodeSync(Vcs.GraphCommit)(Schema.decodeUnknownSync(Vcs.GraphCommit)(commit))).toEqual(commit)
  const page = { commits: [commit], hasMore: true }
  expect(Schema.encodeSync(Vcs.GraphPage)(Schema.decodeUnknownSync(Vcs.GraphPage)(page))).toEqual(page)
  expect(() => Schema.decodeUnknownSync(Vcs.GraphCommit)({ ...commit, authoredAtMs: Number.NaN })).toThrow()
})
