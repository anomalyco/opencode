import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { CronTool } from "../../src/tool/cron"
import { SchedulerStore } from "../../src/scheduler/store"
import { SchedulerRunner } from "../../src/scheduler/runner"
import { SessionID, MessageID } from "../../src/session/schema"
import { AppRuntime } from "@/effect/app-runtime"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import type * as Tool from "../../src/tool/tool"

const original = process.env.OPENCODE_TEST_HOME

afterEach(() => {
  if (original === undefined) delete process.env.OPENCODE_TEST_HOME
  else process.env.OPENCODE_TEST_HOME = original
  mock.restore()
})

const ctx: Tool.Context = {
  sessionID: SessionID.make("session_cron"),
  messageID: MessageID.make("message_cron"),
  callID: "call_cron",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.cron", () => {
  test("add/list/remove", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_HOME = tmp.path
    await fs.mkdir(path.dirname(SchedulerStore.file()), { recursive: true })
    await Bun.write(SchedulerStore.file(), "[]")

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const notify = spyOn(SchedulerRunner, "notify")
        const tool = await AppRuntime.runPromise(CronTool)
        const def = await AppRuntime.runPromise(tool.init())

        const add = await Effect.runPromise(
          def.execute(
            {
              action: "add",
              schedule: "*/5 * * * * *",
              prompt: "run me",
            },
            ctx,
          ),
        )
        expect(add.title.startsWith("tool_")).toBe(true)

        const list = await Effect.runPromise(def.execute({ action: "list" }, ctx))
        expect(list.output).toContain("run me")

        await Effect.runPromise(def.execute({ action: "remove", id: add.title }, ctx))
        const after = await Effect.runPromise(def.execute({ action: "list" }, ctx))
        expect(after.output).not.toContain("run me")
        expect(notify).toHaveBeenCalledTimes(2)
      },
    })
  })
})
