import { expect, test } from "bun:test"
import { LegacyEvent } from "../src/legacy-event"
import { PermissionV1 } from "../src/permission-v1"
import { QuestionV1 } from "../src/question-v1"
import { SessionV1 } from "../src/session-v1"
import { LegacyEvent as IsolatedLegacyEvent } from "../src/v1/legacy-event"
import { PermissionV1 as IsolatedPermissionV1 } from "../src/v1/permission"
import { QuestionV1 as IsolatedQuestionV1 } from "../src/v1/question"
import { SessionV1 as IsolatedSessionV1 } from "../src/v1/session"

test("compatibility entrypoints preserve isolated V1 schema identity", () => {
  expect(LegacyEvent).toBe(IsolatedLegacyEvent)
  expect(PermissionV1).toBe(IsolatedPermissionV1)
  expect(QuestionV1).toBe(IsolatedQuestionV1)
  expect(SessionV1).toBe(IsolatedSessionV1)
})

test("current source does not import the V1 subtree directly", async () => {
  const allowed = new Set(["legacy-event.ts", "permission-v1.ts", "question-v1.ts", "session-v1.ts"])
  const files = [...new Bun.Glob("*.ts").scanSync(new URL("../src", import.meta.url).pathname)].filter(
    (file) => !allowed.has(file),
  )
  const directImports = await Promise.all(
    files.map(async (file) => ({ file, source: await Bun.file(new URL(`../src/${file}`, import.meta.url)).text() })),
  ).then((values) => values.filter((value) => value.source.includes('from "./v1/')))

  expect(directImports).toEqual([])
})
