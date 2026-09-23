import { expect, story } from "../../storybook/playwright/story"

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
