import { expect, test } from "bun:test"
import { renderLocal, session } from "../fixture/local"
import { json } from "../fixture/tui-client"

test("auto approval handles existing and new member requests without a boss screen", async () => {
  const replies: string[] = []
  const pending = {
    id: "per_existing",
    sessionID: "ses_member",
    action: "external_directory",
    resources: ["/other/*"],
    save: ["/other/*"],
  }
  await using setup = await renderLocal({
    args: { auto: true },
    sessions: [{ ...session("ses_member"), parentID: "ses_boss" }],
    fetch: (url) => {
      if (url.pathname === "/api/session/ses_member/permission") return json({ data: [pending] })
      if (url.pathname.endsWith("/reply")) {
        replies.push(url.pathname.split("/").at(-2)!)
        return new Response(null, { status: 204 })
      }
    },
  })
  setup.route.navigate({ type: "session", sessionID: "ses_member" })
  await setup.data.session.sync("ses_member")
  await setup.waitFor(async () => {
    await Bun.sleep(10)
    return replies.includes("per_existing")
  })
  setup.events.emit({
    id: "evt_new",
    type: "permission.asked",
    created: 1,
    data: { ...pending, id: "per_other", sessionID: "ses_other_member" },
  })
  await setup.waitFor(async () => {
    await Bun.sleep(10)
    return replies.includes("per_other")
  })
  expect(replies).toEqual(["per_existing", "per_other"])
})

test("manual mode leaves member requests pending", async () => {
  const replies: string[] = []
  const pending = {
    id: "per_manual",
    sessionID: "ses_member",
    action: "external_directory",
    resources: ["/other/*"],
    save: ["/other/*"],
  }
  await using setup = await renderLocal({
    sessions: [{ ...session("ses_member"), parentID: "ses_boss" }],
    fetch: (url) => {
      if (url.pathname === "/api/session/ses_member/permission") return json({ data: [pending] })
      if (url.pathname.endsWith("/reply")) {
        replies.push(url.pathname.split("/").at(-2)!)
        return new Response(null, { status: 204 })
      }
    },
  })
  setup.route.navigate({ type: "session", sessionID: "ses_member" })
  await setup.data.session.sync("ses_member")
  await setup.data.session.permission.sync("ses_member")
  setup.events.emit({
    id: "evt_manual",
    type: "permission.asked",
    created: 2,
    data: { ...pending, id: "per_manual_new", sessionID: "ses_other_member" },
  })
  await Bun.sleep(100)
  expect(replies).toEqual([])
  expect(setup.data.session.permission.list("ses_member")?.some((item) => item.id === "per_manual")).toBe(true)
})
