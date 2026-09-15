import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Project } from "../src/project.js"

test("project directory checks are bounded", () => {
  expect(
    Schema.decodeUnknownSync(Project.CheckInput)({
      directories: Array.from({ length: 256 }, (_, index) => `/projects/${index}`),
    }).directories,
  ).toHaveLength(256)
  expect(() =>
    Schema.decodeUnknownSync(Project.CheckInput)({
      directories: Array.from({ length: 257 }, (_, index) => `/projects/${index}`),
    }),
  ).toThrow()
})
