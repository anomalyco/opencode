import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Vcs } from "../src/vcs.js"

test("review base preserves its stable identity and omits absent pull-request metadata", () => {
  expect(Vcs.Base.ast.annotations?.identifier).toBe("Vcs.Base")
  const base = { name: "release", ref: "refs/heads/release", source: "configured" as const }
  expect(Schema.encodeSync(Vcs.Base)({ ...base, pullRequest: undefined })).toEqual(base)
  const pr = {
    ...base,
    source: "pull-request",
    pullRequest: { number: 42, url: "https://github.com/team/repo/pull/42" },
  } satisfies Vcs.Base
  expect(Schema.encodeSync(Vcs.Base)(Schema.decodeUnknownSync(Vcs.Base)(pr))).toEqual(pr)
})

test("review modes preserve shipped working and combined branch names", () => {
  for (const mode of ["working", "branch", "committed"] as const) {
    expect(Schema.decodeUnknownSync(Vcs.Mode)(mode)).toBe(mode)
  }
  expect(() => Schema.decodeUnknownSync(Vcs.Mode)("unknown")).toThrow()
})
