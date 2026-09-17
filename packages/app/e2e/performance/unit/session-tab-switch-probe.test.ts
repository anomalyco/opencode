import { expect, test } from "bun:test"
import type { Page } from "@playwright/test"
import { measureSessionSwitch } from "../timeline/session-tab-switch-probe"

function testPage(waitFailure?: Error) {
  const stops: unknown[] = []
  const page = {
    evaluate: async (_callback: unknown, input?: unknown) => {
      if (input) return
      stops.push(undefined)
    },
    waitForFunction: async () => {
      if (waitFailure) throw waitFailure
    },
  } as unknown as Page
  return { page, stops }
}

function input(run: () => Promise<void>) {
  return {
    destinationIDs: ["destination"],
    sourceIDs: ["source"],
    lastID: "destination",
    href: "/session/destination",
    switch: run,
  }
}

test("stops sampling when the session switch fails", async () => {
  const failure = new Error("switch failed")
  const context = testPage()

  await expect(
    measureSessionSwitch(
      context.page,
      input(async () => Promise.reject(failure)),
    ),
  ).rejects.toBe(failure)

  expect(context.stops).toHaveLength(1)
})

test("stops sampling when the stable wait fails", async () => {
  const failure = new Error("stable wait failed")
  const context = testPage(failure)

  await expect(
    measureSessionSwitch(
      context.page,
      input(async () => {}),
    ),
  ).rejects.toBe(failure)

  expect(context.stops).toHaveLength(1)
})
