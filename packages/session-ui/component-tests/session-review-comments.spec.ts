import { expect, story } from "../../stories/playwright/story"

// Selecting text to copy it used to open the comment editor and move focus into it.
story("selected code offers Add comment instead of opening the editor", async ({ mount, page }) => {
  const root = await mount("components-session-review--interactive-comments")
  const review = root.locator('[data-component="session-review"]')
  const code = review.locator('[data-line-type="change-addition"] [data-diff-span]')
  const add = page.getByRole("toolbar", { name: "Selection actions" }).getByRole("button", { name: "Add comment" })

  await code.click()
  const box = await code.boundingBox()

  if (!box) throw new Error("the added line has no layout")
  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(add).toBeVisible()
  await expect(review.getByRole("textbox")).toHaveCount(0)
  await expect(review.locator("[data-selected-line]")).toHaveCount(0)

  await add.click()
  await expect(add).toHaveCount(0)
  await expect(review.getByRole("textbox")).toBeVisible()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on line 2")
})

// Moved from packages/app/e2e/regression/review-line-comment.spec.ts
story("opens the comment editor when a line number is clicked", async ({ mount }) => {
  const root = await mount("components-session-review--interactive-comments")
  const review = root.locator('[data-component="session-review"]')
  await expect(review.getByText("export const first = 1", { exact: true })).toBeVisible()
  const number = review.locator('[data-column-number="1"]')
  await expect(number).toHaveCount(1)
  await number.click()
  await expect(review.getByRole("textbox")).toBeVisible()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on line 1")
})

// Moved from packages/app/e2e/regression/review-line-comment.spec.ts
story("opens the comment editor for a line number range", async ({ mount }) => {
  const root = await mount("components-session-review--interactive-comments")
  const review = root.locator('[data-component="session-review"]')
  const first = review.locator('[data-column-number="1"]')
  const last = review.locator('[data-column-number="3"]')
  await expect(first).toHaveCount(1)
  await expect(last).toHaveCount(1)
  await first.dragTo(last)
  await expect(review.getByRole("textbox")).toBeVisible()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on lines 1-3")
})

// Moved from packages/app/e2e/regression/review-line-comment.spec.ts
story("shows a comment button when a diff line is hovered", async ({ mount }) => {
  const root = await mount("components-session-review--interactive-comments")
  const review = root.locator('[data-component="session-review"]')
  const line = review.getByText("export const first = 1", { exact: true })
  const comment = review.getByRole("button", { name: "Comment", exact: true, includeHidden: true })
  await expect(comment).toHaveCount(1)
  await line.hover()
  await expect(comment).toBeVisible()
  await expect(comment).toHaveCSS("pointer-events", "auto")
  await comment.dispatchEvent("click")
  await expect(review.getByRole("textbox")).toBeVisible()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on line 1")
})

story("dragging the comment button down the gutter comments on every line it covers", async ({ mount, page }) => {
  const root = await mount("components-session-review--interactive-comments")
  const review = root.locator('[data-component="session-review"]')
  const comment = review.getByRole("button", { name: "Comment", exact: true, includeHidden: true })

  await review.getByText("export const first = 1", { exact: true }).hover()
  await expect(comment).toBeVisible()
  const from = await comment.boundingBox()
  const to = await review.locator('[data-column-number="3"]').boundingBox()

  if (!from || !to) throw new Error("the comment button or line 3 has no layout")
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on lines 1-3")

  // The button sits on the range's last line; a click on it used to start a new selection from that line alone.
  await review.locator('[data-column-number="3"]').hover()
  const button = await review.locator('button[aria-label="Comment"]').boundingBox()

  if (!button) throw new Error("the comment button has no layout")
  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on lines 1-3")
})

story("keeps typed comment text while other lines and comments are used", async ({ mount, page }) => {
  const root = await mount("components-session-review--interactive-comments")
  const review = root.locator('[data-component="session-review"]')
  const textbox = review.getByRole("textbox")
  const firstLine = review.getByText("export const first = 1", { exact: true })

  await review.locator('[data-line-type="change-addition"][data-column-number="2"]').click()
  await textbox.fill("first comment")
  await textbox.press("Enter")
  await expect(review.getByText("first comment", { exact: true })).toBeVisible()

  // The gutter button on another line used to replace the open edit with an empty draft.
  await review.getByRole("button", { name: "More options" }).click()
  await page.getByRole("menuitem", { name: "Edit" }).click()
  await expect(textbox).toHaveValue("first comment")
  await textbox.fill("edited comment")
  // A click on another line keeps the edit, and the highlight returns to the edited line.
  await review.locator('[data-column-number="1"]').click()
  await expect(textbox).toHaveValue("edited comment")
  await expect(review.locator('[data-column-number="1"]')).not.toHaveAttribute("data-selected-line")
  await firstLine.hover()
  await review.getByRole("button", { name: "Comment", exact: true, includeHidden: true }).dispatchEvent("click")
  await expect(textbox).toHaveCount(1)
  await expect(textbox).toHaveValue("edited comment")
  await textbox.press("Enter")
  await expect(review.getByText("edited comment", { exact: true })).toBeVisible()

  // Deleting a comment used to discard the draft on another line.
  await review.locator('[data-column-number="1"]').click()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on line 1")
  await textbox.fill("draft text")
  await review.getByRole("button", { name: "More options" }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await expect(review.getByText("edited comment", { exact: true })).toHaveCount(0)
  await expect(textbox).toHaveValue("draft text")
})

story("mentions in a diff comment pick a path, and Escape without a list cancels", async ({ mount }) => {
  const root = await mount("components-session-review--interactive-comments")
  const review = root.locator('[data-component="session-review"]')
  const textbox = review.getByRole("textbox")
  const items = review.locator('[data-slot="line-comment-mention-item"]')

  await review.locator('[data-line-type="change-addition"][data-column-number="2"]').click()
  await textbox.pressSequentially("see @rev")
  await expect(items).toHaveCount(2)
  await textbox.press("ArrowDown")
  await expect(items.nth(1)).toHaveAttribute("data-active", "")
  await textbox.press("Enter")
  await expect(textbox).toHaveValue("see @src/review.test.ts ")
  await expect(items).toHaveCount(0)

  // A bare `@` shows no list, yet used to swallow the first Escape as if one were open.
  await textbox.pressSequentially("@")
  await textbox.press("Escape")
  await expect(textbox).toHaveCount(0)
})

story("a focus request opens the comment and clears once the comment shows", async ({ mount }) => {
  const root = await mount("components-session-review--focused-comment")
  const comment = root.locator('[data-comment-id="comment-1"]')
  const request = root.locator("output")

  await expect(comment).toBeVisible()
  await expect(comment).not.toHaveAttribute("data-open")
  await root.getByRole("button", { name: "Focus comment", exact: true }).click()
  await expect(comment).toHaveAttribute("data-open", "")
  await expect(request).toHaveText("none")
})

story("a focus request for a comment that never renders clears after the reveal times out", async ({ mount, page }) => {
  const root = await mount("components-session-review--focused-comment")
  const request = root.locator("output")

  await expect(root.locator('[data-comment-id="comment-1"]')).toBeVisible()
  await page.clock.install()
  await root.getByRole("button", { name: "Focus missing comment", exact: true }).click()

  // The request used to clear on the next frame, before the comment could render.
  await page.clock.runFor(1000)
  await expect(request).toHaveText("missing")

  await page.clock.runFor(1100)
  await expect(request).toHaveText("none")
})
