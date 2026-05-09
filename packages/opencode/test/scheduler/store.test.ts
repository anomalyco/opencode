import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { SchedulerStore } from "../../src/scheduler/store"
import { tmpdir } from "../fixture/fixture"

const original = process.env.OPENCODE_TEST_HOME

afterEach(() => {
  if (original === undefined) delete process.env.OPENCODE_TEST_HOME
  else process.env.OPENCODE_TEST_HOME = original
})

describe("scheduler.store", () => {
  test("add/list/remove lifecycle", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_HOME = tmp.path
    await fs.mkdir(path.dirname(SchedulerStore.file()), { recursive: true })
    await Bun.write(SchedulerStore.file(), "[]")

    const added = await SchedulerStore.add({
      schedule: "*/5 * * * * *",
      prompt: "hello",
      enabled: true,
    })

    const list = await SchedulerStore.list()
    expect(list.length).toBe(1)
    expect(list[0]?.id).toBe(added.id)

    const ok = await SchedulerStore.remove(added.id)
    expect(ok).toBe(true)
    expect((await SchedulerStore.list()).length).toBe(0)
  })
})
