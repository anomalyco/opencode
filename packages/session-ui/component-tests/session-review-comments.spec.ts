import { expect, story } from "../../stories/playwright/story"

// Moved from packages/app/e2e/regression/review-line-comment.spec.ts
story("opens the comment editor when code is clicked", async ({ mount }) => {
  const root = await mount("components-session-review--interactive-comments")
  const review = root.locator('[data-component="session-review"]')
  await review.locator('[data-line-type="change-addition"] [data-diff-span]').click()
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

story("keeps typed comment text while other lines and comments are used", async ({ mount, page }) => {
  const root = await mount("components-session-review--interactive-comments")
  const review = root.locator('[data-component="session-review"]')
  const textbox = review.getByRole("textbox")
  const firstLine = review.getByText("export const first = 1", { exact: true })

  await review.locator('[data-line-type="change-addition"] [data-diff-span]').click()
  await textbox.fill("first comment")
  await textbox.press("Enter")
  await expect(review.getByText("first comment", { exact: true })).toBeVisible()

  // The gutter button on another line used to replace the open edit with an empty draft.
  await review.getByRole("button", { name: "More options" }).click()
  await page.getByRole("menuitem", { name: "Edit" }).click()
  await expect(textbox).toHaveValue("first comment")
  await textbox.fill("edited comment")
  // A click on another line keeps the edit, and the highlight returns to the edited line.
  await firstLine.click()
  await expect(textbox).toHaveValue("edited comment")
  await expect(review.locator('[data-column-number="1"]')).not.toHaveAttribute("data-selected-line")
  await firstLine.hover()
  await review.getByRole("button", { name: "Comment", exact: true, includeHidden: true }).dispatchEvent("click")
  await expect(textbox).toHaveCount(1)
  await expect(textbox).toHaveValue("edited comment")
  await textbox.press("Enter")
  await expect(review.getByText("edited comment", { exact: true })).toBeVisible()

  // Deleting a comment used to discard the draft on another line.
  await firstLine.click()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on line 1")
  await textbox.fill("draft text")
  await review.getByRole("button", { name: "More options" }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await expect(review.getByText("edited comment", { exact: true })).toHaveCount(0)
  await expect(textbox).toHaveValue("draft text")
})
