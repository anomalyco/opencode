import { expect, sourceURL, story } from "../../stories/playwright/story"
import type { mountSortable } from "./sortable.fixture"

const fixture = sourceURL(new URL("./sortable.fixture.tsx", import.meta.url))

story("arrow keys on a reorder handle move its prompt and keep focus", async ({ mount }) => {
  const component = await mount("session-queue-panel--short")
  const texts = component.locator('[data-action="session-queue-edit"]')

  const handle = component
    .locator('[data-component="session-queue-row"]', { hasText: "Compare the Alpha and Beta fixtures" })
    .getByRole("button", { name: "Reorder queued prompt" })

  await handle.focus()
  await handle.press("ArrowDown")
  await expect(texts).toHaveText([
    "Rename the Alpha export",
    "Compare the Alpha and Beta fixtures",
    "Add a Beta regression test",
  ])
  await expect(handle).toBeFocused()
  await handle.press("ArrowDown")
  await handle.press("ArrowDown")
  await expect(texts).toHaveText([
    "Rename the Alpha export",
    "Add a Beta regression test",
    "Compare the Alpha and Beta fixtures",
  ])
  await handle.press("ArrowUp")
  await expect(texts.nth(1)).toHaveText("Compare the Alpha and Beta fixtures")
  await expect(handle).toBeFocused()
})

story("Escape cancels a drag", async ({ mount, page }) => {
  const component = await mount("session-queue-panel--short")
  const texts = component.locator('[data-action="session-queue-edit"]')
  const order = await texts.allTextContents()
  const handle = component.getByRole("button", { name: "Reorder queued prompt" }).first()
  const box = await handle.boundingBox()

  if (!box) throw new Error("The reorder handle is not visible")

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 70, { steps: 8 })
  await page.keyboard.press("Escape")
  await page.mouse.move(box.x + box.width / 2, box.y + 140, { steps: 8 })

  const clicks = await page.evaluateHandle(() => {
    const seen = { count: 0 }
    document.addEventListener("click", () => seen.count++)

    return seen
  })

  await page.mouse.up()
  await expect(texts).toHaveText(order)
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("")
  // The canceled drag still holds the pointer, so its release must not click whatever it ends over.
  expect(await clicks.evaluate((seen) => seen.count)).toBe(0)
})

story("a drag released before the next frame still reorders", async ({ mount }) => {
  const component = await mount("session-queue-panel--short")
  const texts = component.locator('[data-action="session-queue-edit"]')
  const handle = component.getByRole("button", { name: "Reorder queued prompt" }).first()

  // A fast flick can move and release between two frames, so dispatch the whole gesture in one task.
  await handle.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2

    const send = (type: string, dy: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y + dy }),
      )

    send("pointerdown", 0)
    send("pointermove", 10)
    send("pointermove", 40)
    send("pointerup", 40)
  })
  await expect(texts).toHaveText([
    "Rename the Alpha export",
    "Compare the Alpha and Beta fixtures",
    "Add a Beta regression test",
  ])
})

story("dragging to the edge of a scrolling queue scrolls it", async ({ mount, page }) => {
  const component = await mount("session-queue-panel--scrolling")
  const list = component.locator('[data-slot="session-queue-list"]')
  const texts = component.locator('[data-action="session-queue-edit"]')
  const handle = component.getByRole("button", { name: "Reorder queued prompt" }).first()
  const box = await handle.boundingBox()
  const bounds = await list.boundingBox()

  if (!box || !bounds) throw new Error("The queue is not visible")

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, bounds.y + bounds.height - 2, { steps: 10 })
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(40)
  await page.mouse.up()
  await expect(texts.last()).toHaveText("Compare the Alpha and Beta fixtures")
})

story("a list rebuilt with the same IDs mid-drag keeps the drag", async ({ mount, page }) => {
  await mount("session-queue-panel--short")

  const control = await page.evaluateHandle(async (fixture): Promise<ReturnType<typeof mountSortable>> => {
    const module = await import(fixture)

    return module.mountSortable()
  }, fixture)

  const root = page.getByTestId("sortable-fixture")
  const box = await root.getByText("a", { exact: true }).boundingBox()

  if (!box) throw new Error("The sortable fixture is not visible")

  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 20, box.y + box.height / 2 + 20, { steps: 4 })
  await control.evaluate((sortable) => sortable.recompute())
  await page.mouse.move(box.x + 20, box.y + box.height / 2 + 40, { steps: 4 })
  await page.mouse.up()
  await expect(root.locator("[data-id]")).toHaveText(["b", "a", "c"])
})
