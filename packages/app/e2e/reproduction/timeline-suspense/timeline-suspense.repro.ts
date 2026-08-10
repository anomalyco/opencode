import { expect, test, type Page } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error(error))
  await page.goto("/")
  await expect.poll(() => page.evaluate(() => !!window.timelineSuspense)).toBe(true)
})

test("desired: preserves visible timeline continuity across descendant resource suspension", async ({ page }) => {
  await page.goto("/?reconnect=candidate")
  await expect.poll(() => page.evaluate(() => window.timelineSuspense.snapshot().mode.reconnect)).toBe("candidate")
  const before = await prepare(page)
  await triggerBaselineSuspension(page)
  const pending = await page.evaluate(() => window.timelineSuspense.snapshot())
  expect(pending.nativeOffset).toBe(0)
  expect(pending.coreOffset).toBe(before.coreOffset)
  expect(pending.indexes).toEqual(before.indexes)
  expect(pending.sameRoute).toBe(true)
  expect(pending.sameViewport).toBe(true)
  expect(pending.sameSurface).toBe(true)
  expect(pending.sameMountedRows).toBe(true)

  await resolveSuspension(page)
  await expect.poll(() => page.evaluate(() => window.timelineSuspense.snapshot().coreOffset)).toBe(0)
  await page.waitForTimeout(250)
  await page.evaluate(() => window.timelineSuspense.frames(2))
  const after = await page.evaluate(() => window.timelineSuspense.snapshot())
  expect(after.sameRoute).toBe(true)
  expect(after.sameViewport).toBe(true)
  expect(after.sameSurface).toBe(true)
  expect(after.nativeOffset).toBe(0)
  expect(after.coreOffset).toBe(0)
  expect(after.rangeStart).toBeLessThan(10)
  expect(after.visibleRows, diagnostic({ before, pending, after })).toBeGreaterThan(0)
  expect(after.domScrollEvents).toBe(before.domScrollEvents)
  expect(after.coreOffsetCallbackCalls).toBe(before.coreOffsetCallbackCalls + 1)
  expect(after.offsetCallbackSources.at(-1)).toBe("observer")
  expect(after.syntheticScrollDispatches).toBe(0)
})

test("forensic: proves detached same-node viewport leaves TanStack's bottom range blank until a real scroll", async ({
  page,
}) => {
  const before = await prepare(page)
  const beforeRows = before.domIndexes
  expect(before.mode).toEqual({ resource: "baseline", reconnect: "baseline" })
  expect(before.logicalSurfaceHeight).toBe(80_000)
  expect(before.renderedSurfaceHeight).toBe(80_000)
  expect(before.viewportClientHeight).toBe(600)
  expect(before.viewportScrollHeight).toBe(80_000)
  expect(before.rangeStart).toBeGreaterThan(1_900)
  expect(before.nativeOffset).toBe(before.coreOffset)
  expect(before.visibleRows).toBeGreaterThan(0)

  await triggerBaselineSuspension(page)
  const pending = await page.evaluate(() => window.timelineSuspense.snapshot())
  expect(pending.resourceState).toBe("refreshing")
  expect(pending.routeConnected).toBe(false)
  expect(pending.viewportConnected).toBe(false)
  expect(pending.viewportOwnedByRoute).toBe(true)
  expect(pending.nativeOffset).toBe(0)
  expect(pending.coreOffset).toBe(before.coreOffset)
  expect(pending.rangeStart).toBe(before.rangeStart)
  expect(pending.rangeEnd).toBe(before.rangeEnd)
  expect(pending.indexes).toEqual(before.indexes)
  expect(pending.domIndexes).toEqual(beforeRows)
  expect(pending.sameMountedRows).toBe(true)
  expect(pending.domScrollEvents).toBe(before.domScrollEvents)
  expect(pending.coreOffsetCallbackCalls).toBe(before.coreOffsetCallbackCalls)
  expect(pending.ignoredDetachedZeroRects).toBeGreaterThan(before.ignoredDetachedZeroRects)
  expect(pending.mutationEvents).toHaveLength(1)
  expect(pending.mutationEvents[0]).toMatchObject({
    kind: "removed",
    routeConnectedInCallback: false,
    nativeOffsetInCallback: 0,
  })
  expect(pending.mutationEvents[0]!.callbackTime).toBeLessThanOrEqual(pending.operation.time)
  expect(pending.mutationEvents[0]!.callbackFrame).toBeLessThanOrEqual(pending.operation.frame)

  const after = await resolveSuspension(page)
  expect(after.resourceState).toBe("ready")
  expect(after.routeConnected).toBe(true)
  expect(after.viewportConnected).toBe(true)
  expect(after.viewportOwnedByRoute).toBe(true)
  expect(after.sameRoute).toBe(true)
  expect(after.sameViewport).toBe(true)
  expect(after.sameSurface).toBe(true)
  expect(after.sameMountedRows).toBe(true)
  expect(after.nativeOffset).toBe(0)
  expect(after.coreOffset).toBe(before.coreOffset)
  expect(after.rangeStart).toBe(before.rangeStart)
  expect(after.rangeEnd).toBe(before.rangeEnd)
  expect(after.indexes).toEqual(before.indexes)
  expect(after.domIndexes).toEqual(beforeRows)
  expect(after.domScrollEvents).toBe(before.domScrollEvents)
  expect(after.coreOffsetCallbackCalls).toBe(before.coreOffsetCallbackCalls)
  expect(after.mutationEvents).toHaveLength(2)
  expect(after.mutationEvents[1]).toMatchObject({
    kind: "added",
    routeConnectedInCallback: true,
    nativeOffsetInCallback: 0,
  })
  expect(after.mutationEvents[1]!.callbackTime).toBeLessThanOrEqual(after.operation.time)
  expect(after.mutationEvents[1]!.callbackFrame).toBeLessThanOrEqual(after.operation.frame)
  expect(after.visibleRows).toBe(0)
  expect(after.minimumRowTop).toBeGreaterThan(50_000)
  expect(after.syntheticScrollDispatches).toBe(0)

  await page.locator("[data-viewport]").hover()
  await page.mouse.wheel(0, 80)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = window.timelineSuspense.snapshot()
        return value.nativeOffset > 0 && value.coreOffset === value.nativeOffset
      }),
    )
    .toBe(true)
  await page.evaluate(() => window.timelineSuspense.frames(2))
  const recovered = await page.evaluate(() => window.timelineSuspense.snapshot())
  expect(recovered.domScrollEvents).toBeGreaterThan(after.domScrollEvents)
  expect(recovered.coreOffsetCallbackCalls).toBeGreaterThan(after.coreOffsetCallbackCalls)
  expect(recovered.offsetCallbackSources.at(-1)).toBe("observer")
  expect(recovered.lastScrollTrusted).toBe(true)
  expect(recovered.rangeStart).toBeLessThan(10)
  expect(recovered.visibleRows).toBeGreaterThan(0)
})

test("matrix: fixture-only settled-resource guard keeps the route connected", async ({ page }) => {
  await page.goto("/?resource=guard")
  await expect.poll(() => page.evaluate(() => window.timelineSuspense.snapshot().mode.resource)).toBe("guard")
  const before = await prepare(page)

  await page.evaluate(() => window.timelineSuspense.trigger())
  await expect.poll(() => page.evaluate(() => window.timelineSuspense.snapshot().resourceState)).toBe("refreshing")
  await page.evaluate(() => window.timelineSuspense.frames(3))
  const pending = await page.evaluate(() => window.timelineSuspense.snapshot())
  expect(pending.routeConnected).toBe(true)
  expect(pending.mutationEvents).toEqual([])
  expect(pending.nativeOffset).toBe(before.nativeOffset)
  expect(pending.coreOffset).toBe(before.coreOffset)
  expect(pending.visibleRows).toBeGreaterThan(0)

  const after = await resolveSuspension(page)
  expect(after.routeConnected).toBe(true)
  expect(after.nativeOffset).toBe(before.nativeOffset)
  expect(after.coreOffset).toBe(before.coreOffset)
  expect(after.visibleRows).toBeGreaterThan(0)
})

async function prepare(page: Page) {
  const before = await page.evaluate(() => window.timelineSuspense.prepare())
  expect(before.routeConnected).toBe(true)
  expect(before.viewportConnected).toBe(true)
  expect(before.viewportOwnedByRoute).toBe(true)
  expect(before.sameMountedRows).toBe(true)
  expect(before.rangeStart).toBeGreaterThan(1_900)
  expect(before.nativeOffset).toBe(before.coreOffset)
  return before
}

async function triggerBaselineSuspension(page: Page) {
  await page.evaluate(() => window.timelineSuspense.trigger())
  await expect.poll(() => page.evaluate(() => window.timelineSuspense.snapshot().resourceState)).toBe("refreshing")
  await expect.poll(() => page.evaluate(() => window.timelineSuspense.snapshot().routeConnected)).toBe(false)
  await page.evaluate(() => window.timelineSuspense.frames(3))
}

async function resolveSuspension(page: Page) {
  await page.evaluate(() => window.timelineSuspense.resolve())
  await expect.poll(() => page.evaluate(() => window.timelineSuspense.snapshot().resourceState)).toBe("ready")
  await expect.poll(() => page.evaluate(() => window.timelineSuspense.snapshot().routeConnected)).toBe(true)
  await page.evaluate(() => window.timelineSuspense.frames(3))
  return page.evaluate(() => window.timelineSuspense.snapshot())
}

function diagnostic(value: unknown) {
  return JSON.stringify(value, null, 2)
}
