/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount, wait } from "./sync-fixture"

const session = {
  id: "ses_resume",
  title: "Resume target",
  slug: "resume-target",
  projectID: "proj_test",
  directory,
  version: "1.15.13",
  time: { created: 0, updated: 0 },
}

// /vcs is only fetched by bootstrap's non-blocking phase, so its position in
// the request log marks when bootstrap leaves the blocking ("loading") phase.
// The fixture's sync handle is gated behind sync.ready, so blocking-phase
// behavior is observed through the request log instead of sync.status.
describe("tui sync --resume", () => {
  test("bootstrap blocks on the session list and fetches it once", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    const order: string[] = []
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const mounted = mount(
      (url) => {
        if (url.pathname === "/session") {
          order.push("session")
          return pending
        }
        if (url.pathname === "/vcs") order.push("vcs")
        return undefined
      },
      tmp.path,
      { args: { resume: true } },
    )

    await wait(() => order.includes("session"))
    await Bun.sleep(30)
    const blocked = !order.includes("vcs")
    release(json([session]))
    const { app, sync, session: calls } = await mounted

    try {
      expect(blocked).toBe(true)
      expect(order).toEqual(["session", "vcs"])
      expect(sync.data.session.map((x) => x.id)).toEqual([session.id])
      expect(calls).toHaveLength(1)
    } finally {
      app.renderer.destroy()
    }
  })

  test("without --resume the session list loads after bootstrap unblocks", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    const order: string[] = []
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const mounted = mount(
      (url) => {
        if (url.pathname === "/session") {
          order.push("session")
          return pending
        }
        if (url.pathname === "/vcs") order.push("vcs")
        return undefined
      },
      tmp.path,
    )

    await wait(() => order.includes("session"))
    await wait(() => order.includes("vcs"))
    release(json([session]))
    const { app, sync, session: calls } = await mounted

    try {
      expect(order).toEqual(["session", "vcs"])
      expect(sync.data.session.map((x) => x.id)).toEqual([session.id])
      expect(calls).toHaveLength(1)
    } finally {
      app.renderer.destroy()
    }
  })
})
