import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./file-viewer.fixture.tsx", import.meta.url))

story("updates a text file in place when its props change", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountTextViewer(40), fixture)
  const root = page.getByTestId("file-viewer-fixture")
  await expect(root.locator('[data-line="40"]')).toHaveCount(1)
  await page.evaluate(async (fixture) => (await import(fixture)).controls.keepHost(), fixture)

  await page.evaluate(async (fixture) => (await import(fixture)).controls.setOverflow("scroll"), fixture)
  await expect(root.locator('pre[data-overflow="scroll"]')).toHaveCount(1)
  await page.evaluate(async (fixture) => (await import(fixture)).controls.append("const appended = true\n"), fixture)
  await expect(root.locator('[data-line="41"]')).toContainText("appended")

  expect(await page.evaluate(async (fixture) => (await import(fixture)).controls.sameHost(), fixture)).toBe(true)
})

story("windows a medium text file and keeps selection and comment marks", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountTextViewer(480), fixture)
  const root = page.getByTestId("file-viewer-fixture")
  await expect(root.locator('[data-line="1"]')).toBeInViewport()
  expect(await root.locator("[data-line]").count()).toBeLessThan(200)

  await page.evaluate(async (fixture) => {
    const { controls } = await import(fixture)
    controls.setSelected({ start: 3, end: 5 })
    controls.setCommented([{ start: 8, end: 8 }])
  }, fixture)
  await expect(root.locator("[data-line][data-selected-line]")).toHaveCount(3)
  await expect(root.locator('[data-line="8"][data-comment-selected]')).toHaveCount(1)

  // File links jump by setting the scroll offset from the line number; the window must follow it.
  await root.evaluate((element) => (element.scrollTop = (400 - 4) * 24))
  await expect(root.locator('[data-line="400"]')).toBeInViewport()
})

story("selects lines by dragging over the code and over the line numbers", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountTextViewer(40), fixture)
  const root = page.getByTestId("file-viewer-fixture")
  await expect(root.locator('[data-line="40"]')).toHaveCount(1)
  const ends = () => page.evaluate(async (fixture) => (await import(fixture)).controls.ends(), fixture)

  const from = await root.locator('[data-line="3"]').boundingBox()
  const to = await root.locator('[data-line="6"]').boundingBox()

  if (!from || !to) throw new Error("lines 3 and 6 have no layout")
  await page.mouse.move(from.x + 8, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect(root.locator("[data-line][data-selected-line]")).toHaveCount(4)
  await expect.poll(ends).toEqual([{ start: 3, end: 6 }])

  const first = await root.locator('[data-column-number="8"]').boundingBox()
  const last = await root.locator('[data-column-number="10"]').boundingBox()

  if (!first || !last) throw new Error("line numbers 8 and 10 have no layout")
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(root.locator("[data-line][data-selected-line]")).toHaveCount(3)
  await expect.poll(ends).toEqual([
    { start: 3, end: 6 },
    { start: 8, end: 10 },
  ])
})

story("commits a drag whose text selection stays collapsed", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountTextViewer(40), fixture)
  const root = page.getByTestId("file-viewer-fixture")
  await expect(root.locator('[data-line="40"]')).toHaveCount(1)

  // Script-dispatched mouse events leave no text selection, as a drag over trailing whitespace can.
  await page.evaluate(
    async (fixture) =>
      (await import(fixture)).controls.gesture([
        ["mousedown", 3],
        ["mousemove", 6],
        ["mouseup", 6],
      ]),
    fixture,
  )
  await expect(root.locator("[data-line][data-selected-line]")).toHaveCount(4)
  await expect
    .poll(() => page.evaluate(async (fixture) => (await import(fixture)).controls.ends(), fixture))
    .toEqual([{ start: 3, end: 6 }])
})

story("does not end a drag that a fast second press replaced", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountTextViewer(40), fixture)
  const root = page.getByTestId("file-viewer-fixture")
  await expect(root.locator('[data-line="40"]')).toHaveCount(1)
  const ends = () => page.evaluate(async (fixture) => (await import(fixture)).controls.ends(), fixture)

  // The second press lands before the first drag's finishing frame runs.
  await page.evaluate(
    async (fixture) =>
      (await import(fixture)).controls.gesture([
        ["mousedown", 2],
        ["mousemove", 5],
        ["mouseup", 5],
        ["mousedown", 10],
        ["mousemove", 12],
      ]),
    fixture,
  )
  await expect(root.locator("[data-line][data-selected-line]")).toHaveCount(3)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await ends()).toEqual([])

  await page.evaluate(async (fixture) => (await import(fixture)).controls.gesture([["mouseup", 12]]), fixture)
  await expect.poll(ends).toEqual([{ start: 10, end: 12 }])
})

story("releases the pinned height when a diff becomes empty", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountChangingDiff(40), fixture)
  const root = page.getByTestId("file-viewer-fixture")
  await expect(root.locator('[data-line-type="change-addition"]').first()).toBeVisible()
  const pinned = () => page.evaluate(async (fixture) => (await import(fixture)).controls.pinnedHeight(), fixture)
  await expect.poll(pinned).toBe("")

  await page.evaluate(async (fixture) => (await import(fixture)).controls.clearDiff(), fixture)
  await expect(root.locator('[data-line-type="change-addition"]')).toHaveCount(0)
  await expect.poll(pinned).toBe("")
})

story("scrolls a virtualized diff to an off-screen selection", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountDiffViewer(480), fixture)
  const root = page.getByTestId("file-viewer-fixture")
  await expect(root.locator('[data-line="1"]').first()).toBeVisible()
  await expect(root.locator('[data-line="400"]')).toHaveCount(0)

  await page.evaluate(
    async (fixture) => (await import(fixture)).controls.setSelected({ start: 400, end: 400, side: "additions" }),
    fixture,
  )
  await expect(root.locator('[data-line="400"][data-selected-line]').first()).toBeInViewport()
})
