/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"

const question: QuestionRequest = {
  id: "que_pending",
  sessionID: "ses_test",
  questions: [{ question: "Proceed?", header: "Q", options: [{ label: "Yes", description: "Continue" }] }],
}

const permission: PermissionRequest = {
  id: "per_pending",
  sessionID: "ses_test",
  permission: "read",
  patterns: ["src/index.ts"],
  metadata: {},
  always: ["*"],
}

describe("tui sync pending prompts", () => {
  test("hydrates pending prompts on bootstrap and drops entries a restarted server no longer knows", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let questions: QuestionRequest[] = [question]
    let permissions: PermissionRequest[] = [permission]
    const { app, sync } = await mount((url) => {
      if (url.pathname === "/question") return json(questions)
      if (url.pathname === "/permission") return json(permissions)
      return undefined
    }, tmp.path)

    try {
      await wait(() => (sync.data.question["ses_test"]?.length ?? 0) === 1)
      await wait(() => (sync.data.permission["ses_test"]?.length ?? 0) === 1)
      expect(sync.data.question["ses_test"]?.[0]?.id).toBe("que_pending")
      expect(sync.data.permission["ses_test"]?.[0]?.id).toBe("per_pending")

      questions = []
      permissions = []
      await sync.bootstrap()
      await wait(() => (sync.data.question["ses_test"]?.length ?? 0) === 0)
      await wait(() => (sync.data.permission["ses_test"]?.length ?? 0) === 0)
    } finally {
      app.renderer.destroy()
    }
  })

  test("dismisses a question the server can no longer answer", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount(undefined, tmp.path)

    try {
      emit({
        directory: "/tmp/opencode/packages/tui",
        project: "proj_test",
        payload: { id: "evt_question", type: "question.asked", properties: question },
      })
      await wait(() => (sync.data.question["ses_test"]?.length ?? 0) === 1)

      sync.question.dismiss("ses_test", "que_pending")
      expect(sync.data.question["ses_test"]).toEqual([])
      sync.question.dismiss("ses_test", "que_pending")
      expect(sync.data.question["ses_test"]).toEqual([])
    } finally {
      app.renderer.destroy()
    }
  })
})
