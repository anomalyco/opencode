import { expect, test } from "bun:test"
import { renderLocal, session } from "../fixture/local"

test("permission mode applies to one session and its subagents only", async () => {
  await using setup = await renderLocal()
  setup.data.session.remember(session("ses_first"))
  setup.data.session.remember({ ...session("ses_child"), parentID: "ses_first" })
  setup.data.session.remember(session("ses_second"))

  await setup.local.permission.set("ses_first", "autoaccept")
  expect(setup.local.permission.mode("ses_first")).toBe("autoaccept")
  expect(setup.local.permission.mode("ses_child")).toBe("autoaccept")
  expect(setup.local.permission.mode("ses_second")).toBe("prompt")
  expect(setup.local.permission.mode()).toBe("prompt")

  await setup.local.permission.set("ses_child", "prompt")
  expect(setup.local.permission.mode("ses_first")).toBe("prompt")
})

test("a deleted session's permission mode is forgotten", async () => {
  await using setup = await renderLocal()
  setup.data.session.remember(session("ses_first"))
  await setup.local.permission.set("ses_first", "autoaccept")

  setup.events.emit({
    id: "evt_deleted",
    type: "session.deleted",
    created: 1,
    durable: { aggregateID: "ses_first", seq: 1, version: 2 },
    data: { sessionID: "ses_first" },
  })
  await wait(() => setup.local.permission.mode("ses_first") === "prompt")
})

test("a session's own permission mode overrides --auto", async () => {
  await using setup = await renderLocal({ args: { auto: true } })
  setup.data.session.remember(session("ses_first"))

  await setup.local.permission.set("ses_first", "prompt")
  expect(setup.local.permission.mode("ses_first")).toBe("prompt")
  expect(setup.local.permission.mode("ses_second")).toBe("autoaccept")
})

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}
