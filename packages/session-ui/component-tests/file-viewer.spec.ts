import { expect, sourceURL, test } from "../../lab/playwright/test"

const fixture = sourceURL(new URL("./file-viewer.fixture.tsx", import.meta.url))

test("updates a text file in place when its props change", async ({ mount, page }) => {
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

test("windows a medium text file and keeps selection and comment marks", async ({ mount, page }) => {
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

test(
  "selects text when dragging over the code and lines when dragging over the line numbers",
  async ({ mount, page }) => {
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
    await expect(page.getByRole("toolbar", { name: "Selection actions" })).toBeVisible()

    const first = await root.locator('[data-column-number="8"]').boundingBox()
    const last = await root.locator('[data-column-number="10"]').boundingBox()

    if (!first || !last) throw new Error("line numbers 8 and 10 have no layout")
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
    await page.mouse.down()
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect(root.locator("[data-line][data-selected-line]")).toHaveCount(3)
    // The text drag ended no line selection.
    await expect.poll(ends).toEqual([{ start: 8, end: 10 }])
  },
)

test("comments on the lines a selection covers, not the next one it ends at", async ({ mount, page }) => {
  await mount("components-markdown--compact-result")
  await page.evaluate(async (fixture) => (await import(fixture)).mountTextViewer(40), fixture)
  const root = page.getByTestId("file-viewer-fixture")
  const add = page.getByRole("toolbar", { name: "Selection actions" }).getByRole("button", { name: "Add comment" })
  await expect(root.locator('[data-line="40"]')).toHaveCount(1)

  // A triple click selects line 3 up to the start of line 4.
  await root.locator('[data-line="3"]').click({ clickCount: 3 })
  await expect(add).toBeVisible()
  const line = await root.locator('[data-line="3"]').boundingBox()
  const toolbar = await page.getByRole("toolbar", { name: "Selection actions" }).boundingBox()

  if (!line || !toolbar) throw new Error("line 3 or the toolbar has no layout")
  // A one-line selection gets the toolbar above it, not below the next line.
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(line.y)
  await add.click()

  // A drag that starts past the end of line 7 selects only its line break, so it comments from line 8.
  const from = await root.locator('[data-line="7"]').boundingBox()
  const to = await root.locator('[data-line="9"]').boundingBox()

  if (!from || !to) throw new Error("lines 7 and 9 have no layout")
  await page.mouse.move(from.x + from.width - 4, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 6 })
  await page.mouse.up()
  await add.click()
  await expect
    .poll(() => page.evaluate(async (fixture) => (await import(fixture)).controls.comments(), fixture))
    .toEqual([
      { start: 3, end: 3 },
      { start: 8, end: 9 },
    ])
})

test("releases the pinned height when a diff becomes empty", async ({ mount, page }) => {
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

test("scrolls a virtualized diff to an off-screen selection", async ({ mount, page }) => {
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
