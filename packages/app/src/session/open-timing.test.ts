import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { sessionOpenTiming } from "./open-timing"

type Rect = { top: number; bottom: number }

const rects = new Map<Element, Rect>()

const original = {
  rect: Element.prototype.getBoundingClientRect,
  visible: Element.prototype.checkVisibility,
  info: console.info,
}

beforeAll(() => {
  // happy-dom has no layout; rows report the geometry each test gives them.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const rect = rects.get(this) ?? { top: 0, bottom: 0 }

    return DOMRect.fromRect({ x: 0, y: rect.top, width: 100, height: rect.bottom - rect.top })
  }

  Element.prototype.checkVisibility = () => true
  console.info = () => {}
})

afterAll(() => {
  Element.prototype.getBoundingClientRect = original.rect
  Element.prototype.checkVisibility = original.visible
  console.info = original.info
})

beforeEach(() => {
  sessionOpenTiming.cancel()
  document.body.replaceChildren()
  rects.clear()
})

const opens = () => window.__opencodeSessionOpens ?? []

async function nextOpen(count: number) {
  for (let waited = 0; waited < 3_000; waited += 10) {
    if (opens().length > count) return opens()[count]!
    await Bun.sleep(10)
  }

  throw new Error("no session open was logged")
}

function mount(sessionID: string, input: { pinned: boolean; newestInView: boolean }) {
  const scroll = document.createElement("div")
  const content = document.createElement("div")
  const row = document.createElement("div")
  const spacer = document.createElement("div")

  scroll.setAttribute("data-slot", "session-timeline-scroll")
  content.setAttribute("data-timeline-virtual-content", "")
  content.setAttribute("data-timeline-session-key", `server/${sessionID}`)

  if (input.pinned) content.setAttribute("data-timeline-pinned", "")
  row.setAttribute("data-timeline-key", "row")
  spacer.setAttribute("data-timeline-row", "bottom-spacer")
  rects.set(scroll, { top: 0, bottom: 500 })
  rects.set(row, { top: 100, bottom: 200 })
  rects.set(spacer, input.newestInView ? { top: 400, bottom: 464 } : { top: 900, bottom: 964 })
  content.append(row, spacer)
  scroll.append(content)
  document.body.append(scroll)
}

const server = (handler: (resource: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch =>
  Object.assign(handler, { preconnect: () => {} })

const respond = server(async () => new Response("[]", { headers: { "content-length": "2" } }))

describe("sessionOpenTiming", () => {
  test("attributes a transcript request that Home starts before the route changes", async () => {
    const count = opens().length

    await sessionOpenTiming.fetch(respond)("http://server/api/session/ses_home/message?limit=20&order=desc")
    sessionOpenTiming.start("ses_home", () => 20)
    mount("ses_home", { pinned: true, newestInView: true })
    sessionOpenTiming.stored("ses_home")
    const open = await nextOpen(count)

    expect(open.outcome).toBe("idle")
    expect(open.requests).toMatchObject([{ path: "message?limit=20&order=desc", status: 200, bytes: 2 }])
    expect(open.newestRowStableMs).toBeNumber()
  })

  test("ignores rows that belong to another session's timeline", async () => {
    const count = opens().length

    mount("ses_outgoing", { pinned: true, newestInView: true })
    sessionOpenTiming.start("ses_incoming", () => 20)
    sessionOpenTiming.stored("ses_incoming")
    await Bun.sleep(100)
    document.body.replaceChildren()
    mount("ses_incoming", { pinned: true, newestInView: true })
    const open = await nextOpen(count)

    expect(open.outcome).toBe("idle")
    expect(open.firstRowMs).toBeGreaterThanOrEqual(100)
  })

  test("settles an unpinned open whose newest row is off screen", async () => {
    const count = opens().length

    mount("ses_unpinned", { pinned: false, newestInView: false })
    sessionOpenTiming.start("ses_unpinned", () => 20)
    sessionOpenTiming.stored("ses_unpinned")
    const open = await nextOpen(count)

    expect(open.outcome).toBe("idle")
    expect(open.firstRowStableMs).toBeNumber()
    expect(open.newestRowMs).toBeUndefined()
  })

  test("leaving the route logs the open and stops sampling", async () => {
    const count = opens().length
    const frame = window.requestAnimationFrame
    let frames = 0

    window.requestAnimationFrame = (callback) => {
      frames++

      return frame(callback)
    }

    try {
      sessionOpenTiming.start("ses_left", () => 0)
      await Bun.sleep(50)
      sessionOpenTiming.cancel()
      expect((await nextOpen(count)).outcome).toBe("left")
      await Bun.sleep(30)
      const settled = frames

      await Bun.sleep(100)
      expect(frames).toBe(settled)
    } finally {
      window.requestAnimationFrame = frame
    }
  })

  test("counts only GET message pages, and a late response leaves the logged open unchanged", async () => {
    const count = opens().length
    const late = Promise.withResolvers<Response>()

    const tap = sessionOpenTiming.fetch(
      server(async (resource, init) => {
        if (!init?.method && new URL(resource.toString()).pathname.endsWith("/message")) return late.promise

        return new Response(null, { status: init?.method === "POST" ? 204 : 200 })
      }),
    )

    sessionOpenTiming.start("ses_writes", () => 0)
    await tap("http://server/api/session/ses_writes")
    await tap("http://server/api/session/ses_writes/inbox", { method: "POST" })
    await tap("http://server/api/session/ses_writes/message", { method: "PATCH" })
    const page = tap("http://server/api/session/ses_writes/message?limit=20&cursor=opaque")

    sessionOpenTiming.cancel()
    const open = await nextOpen(count)

    late.resolve(new Response("[]"))
    await page

    expect(open.requests).toEqual([{ path: "message?limit=20&cursor", startMs: expect.any(Number) }])
  })
})
