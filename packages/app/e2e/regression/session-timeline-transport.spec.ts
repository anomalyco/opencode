import { expect, test } from "@playwright/test"
import { partUpdated, setupTimeline, textPart } from "../performance/timeline-stability/fixture"

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

test("does not request replay when reconnecting the volatile event stream", async ({ page }) => {
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
