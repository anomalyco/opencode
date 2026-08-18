import { expect, test, type Page } from "@playwright/test"
import { partUpdated, renderedPartID, setupTimeline, textPart } from "../performance/timeline-stability/fixture"

test("keeps one connection open while delivering multiple events", async ({ page }) => {
  const timeline = await setupTimeline(page)

  const first = (await timeline.transport.burst(partUpdated(textPart("prt_transport_first", "first event")))).at(-1)!
  const second = (await timeline.transport.burst(partUpdated(textPart("prt_transport_second", "second event")))).at(-1)!

  await timeline.waitForPart("prt_transport_first")
  await timeline.waitForPart("prt_transport_second")
  expect(first.connectionID).toBe(second.connectionID)
  await expect.poll(async () => (await timeline.transport.connections()).length).toBe(1)
  expect(await timeline.transport.acknowledgements()).toHaveLength(4)
})

test("delivers a burst from one stream chunk", async ({ page }) => {
  const timeline = await setupTimeline(page)
  const acknowledgements = await timeline.transport.burst([
    ...partUpdated(textPart("prt_transport_burst_a", "burst a")),
    ...partUpdated(textPart("prt_transport_burst_b", "burst b")),
  ])

  await timeline.waitForPart("prt_transport_burst_a")
  await timeline.waitForPart("prt_transport_burst_b")
  expect(acknowledgements.map((item) => item.chunkCount)).toEqual([1, 1, 1, 1])
  expect(new Set(acknowledgements.map((item) => item.deliveryID)).size).toBe(4)
})

test("parses split JSON and a split multibyte code point", async ({ page }) => {
  const timeline = await setupTimeline(page)
  const [started, payload] = partUpdated(textPart("prt_transport_split", "split snowman \u2603\u2603\u2603"))
  await timeline.transport.send(started!)
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
  const snowman = new TextEncoder().encode("\u2603")[0]!
  const multibyte = encoded.indexOf(snowman)

  const acknowledgement = await timeline.transport.split(payload!, [9, multibyte + 1, multibyte + 2])

  await timeline.waitForPart("prt_transport_split")
  await expect(page.locator(`[data-timeline-part-id="${renderedPartID("prt_transport_split")}"]`)).toContainText(
    "split snowman \u2603\u2603\u2603",
  )
  expect(acknowledgement.chunkCount).toBe(4)
})

test("delivers server heartbeat without mutating the timeline", async ({ page }) => {
  const timeline = await setupTimeline(page)
  const partID = "prt_transport_heartbeat_sentinel"
  const sentinel = (await timeline.transport.burst(partUpdated(textPart(partID, "heartbeat sentinel")))).at(-1)!
  await timeline.waitForPart(partID)
  await expect(
    page.locator(`[data-timeline-part-id="${renderedPartID(partID)}"] [data-component="markdown"]`),
  ).toHaveAttribute("data-markdown-ready", "")
  const before = await timelineRows(page)
  const heartbeat = await timeline.transport.heartbeat()

  await expect.poll(() => timelineRows(page)).toEqual(before)
  expect(heartbeat.connectionID).toBe(sentinel.connectionID)
  await expect.poll(async () => (await timeline.transport.connections()).length).toBe(1)
})

test("reconnects after a clean close", async ({ page }) => {
  const timeline = await setupTimeline(page)
  const first = await timeline.transport.waitForConnection()

  await timeline.transport.close()
  const second = await timeline.transport.waitForConnection({ after: first.id })
  await timeline.transport.burst(partUpdated(textPart("prt_transport_close", "after close")))

  await timeline.waitForPart("prt_transport_close")
  expect(second.id).toBeGreaterThan(first.id)
  expect((await timeline.transport.connections())[0]?.endedBy).toBe("close")
})

test("reconnects after a stream error", async ({ page }) => {
  const timeline = await setupTimeline(page)
  const first = await timeline.transport.waitForConnection()

  await timeline.transport.error("contract failure")
  const second = await timeline.transport.waitForConnection({ after: first.id })
  await timeline.transport.burst(partUpdated(textPart("prt_transport_error", "after error")))

  await timeline.waitForPart("prt_transport_error")
  await expect.poll(async () => (await timeline.transport.connections()).length).toBe(2)
  expect(second.id).toBeGreaterThan(first.id)
  expect((await timeline.transport.connections())[0]?.endedBy).toBe("error")
})

test("does not request replay when reconnecting the volatile V2 event stream", async ({ page }) => {
  const timeline = await setupTimeline(page, { eventRetry: 10 })
  const events = partUpdated(textPart("prt_transport_id", "event with id"))
  const first = (
    await timeline.transport.burst(
      events,
      events.map((_, index) => (index === events.length - 1 ? { id: "timeline-event-7" } : {})),
    )
  ).at(-1)!
  await timeline.waitForPart("prt_transport_id")

  await timeline.transport.error("retry with event id")
  const connection = await timeline.transport.waitForConnection({ after: first.connectionID })

  expect(first.eventID).toBe("timeline-event-7")
  expect(connection.headers["last-event-id"]).toBeUndefined()
})

test("passes through non-event fetches", async ({ page }) => {
  const timeline = await setupTimeline(page)

  const health = await page.evaluate(async () => {
    const response = await fetch("/api/health")
    return response.json()
  })

  expect(health).toEqual({ healthy: true, version: "2.0.0", pid: 1 })
  await expect.poll(async () => (await timeline.transport.connections()).length).toBe(1)
})

function timelineRows(page: Page) {
  return page.locator("[data-timeline-row]").evaluateAll((rows) =>
    rows.map((row) => ({
      kind: row.getAttribute("data-timeline-row"),
      message: row.getAttribute("data-message-id"),
      parts: Array.from(row.querySelectorAll("[data-timeline-part-id]"), (part) =>
        part.getAttribute("data-timeline-part-id"),
      ),
      text: row.textContent,
    })),
  )
}
