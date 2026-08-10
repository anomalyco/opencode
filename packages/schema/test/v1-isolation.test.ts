import { expect, test } from "bun:test"
import { LegacyEventV1 } from "../src/legacy-event.js"
import { PermissionV1 } from "../src/permission-v1.js"
import { QuestionV1 } from "../src/question-v1.js"
import { SessionV1 } from "../src/session-v1.js"
const isolatedLegacyEvent = await import("../src/v1/legacy-event.js")
const isolatedPermission = await import("../src/v1/permission.js")
const isolatedQuestion = await import("../src/v1/question.js")
const isolatedSession = await import("../src/v1/session.js")

test("compatibility entrypoints preserve isolated V1 schema identity", () => {
  expect(LegacyEventV1).toBe(isolatedLegacyEvent.LegacyEventV1)
  expect(PermissionV1).toBe(isolatedPermission.PermissionV1)
  expect(QuestionV1).toBe(isolatedQuestion.QuestionV1)
  expect(SessionV1).toBe(isolatedSession.SessionV1)
})

test("current source does not import the V1 subtree directly", async () => {
  const allowed = new Set([
    "filesystem-v1.ts",
    "legacy-event.ts",
    "permission-v1.ts",
    "question-v1.ts",
    "session-v1.ts",
  ])
  const files = [...new Bun.Glob("*.ts").scanSync(new URL("../src", import.meta.url).pathname)].filter(
    (file) => !allowed.has(file),
  )
  const directImports = await Promise.all(
    files.map(async (file) => ({ file, source: await Bun.file(new URL(`../src/${file}`, import.meta.url)).text() })),
  ).then((values) => values.filter((value) => value.source.includes('from "./v1/')))

  expect(directImports).toEqual([])
})
