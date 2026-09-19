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

for (const direction of ["ltr", "rtl"]) {
  story(`offers a comment action for selected review text in ${direction}`, async ({ mount, page }) => {
    const root = await mount("components-session-review--interactive-comments-panel", { globals: { direction } })
    const action = page.getByRole("button", { name: "Add comment", exact: true })
    await expect(async () => {
      await root.locator('[data-line-type="change-addition"] [data-diff-span]').selectText()
      await expect(action).toBeVisible()
    }).toPass()
    await expect(root.getByRole("textbox")).not.toBeVisible()

    await expect(action).toHaveAttribute("data-variant", "submit")
    await expect(action).toHaveCSS("z-index", "110")
    const box = await action.boundingBox()
    const code = root.locator("[data-code]").first()
    const gutterRight = await code.evaluate((element) => element.firstElementChild?.getBoundingClientRect().right)
    expect((box?.x ?? 0) - (gutterRight ?? 0)).toBe(8)
    expect(box?.x).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    )
    await action.click()

    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("")
    await expect(root.getByRole("textbox")).toBeVisible()
    await expect(root.locator('[data-line="2"][data-line-type="change-addition"]')).toHaveAttribute(
      "data-selected-line",
      /.*/,
    )
  })
}

for (const direction of ["up", "down"] as const) {
  story(
    `positions the comment action with ${direction === "up" ? "an upward" : "a downward"} selection`,
    async ({ mount, page }) => {
      const root = await mount("components-session-review--interactive-comments-panel")
      const action = page.getByRole("button", { name: "Add comment", exact: true })
      await expect(async () => {
        await root.getByText("export const first = 1", { exact: true }).evaluate((element, value) => {
          const root = element.getRootNode()
          if (!(root instanceof ShadowRoot)) throw new Error("Expected a shadow root")
          const text = (line: number) => {
            const row = root.querySelector(`[data-line="${line}"]`)
            if (!row) throw new Error(`Missing line ${line}`)
            const node = document.createTreeWalker(row, NodeFilter.SHOW_TEXT).nextNode()
            if (!node) throw new Error(`Missing text for line ${line}`)
            return node
          }
          const first = text(1)
          const last = text(3)
          const selection = window.getSelection()
          if (!selection) throw new Error("Missing selection")
          if (value === "up") {
            selection.setBaseAndExtent(last, last.textContent?.length ?? 0, first, 0)
          } else {
            selection.setBaseAndExtent(first, 0, last, last.textContent?.length ?? 0)
          }
          document.dispatchEvent(new Event("selectionchange"))
        }, direction)
        await expect(action).toHaveAttribute("data-placement", direction === "up" ? "top" : "bottom")
        await expect(action).toHaveClass(/transition-transform/)
        await expect(action).toHaveClass(/ease-out/)
        await expect(action).not.toHaveClass(/fade-in/)
        await expect
          .poll(() =>
            action.evaluate((button) => {
              const host = button.closest('[data-component="file"]')?.querySelector("diffs-container")
              const root = host?.shadowRoot
              if (!root) return NaN
              const selection =
                (root as unknown as { getSelection?: () => Selection | null }).getSelection?.() ??
                window.getSelection()
              const source = (
                selection as unknown as {
                  getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => StaticRange[]
                }
              )?.getComposedRanges?.({ shadowRoots: [root] })?.[0]
              if (!source) return NaN
              const range = new Range()
              range.setStart(source.startContainer, source.startOffset)
              range.setEnd(source.endContainer, source.endOffset)
              const selected = range.getBoundingClientRect()
              const action = button.getBoundingClientRect()
              return button.getAttribute("data-placement") === "top"
                ? selected.top - action.bottom
                : action.top - selected.bottom
            }),
          )
          .toBeCloseTo(8, 0)
      }).toPass()
    },
  )
}

story("leaves a review code click as regular text interaction", async ({ mount }) => {
  const root = await mount("components-session-review--interactive-comments-panel")
  await root.locator('[data-line-type="change-addition"] [data-diff-span]').click()
  await expect(root.getByRole("textbox")).not.toBeVisible()
})

story("keeps direct line-number range comments in the review panel", async ({ mount }) => {
  const root = await mount("components-session-review--interactive-comments-panel")
  await root.locator('[data-column-number="1"]').dragTo(root.locator('[data-column-number="3"]'))
  await expect(root.getByRole("textbox")).toBeVisible()
  await expect(root.locator("[data-selected-line]")).not.toHaveCount(0)
})

story("keeps the direct gutter comment action in the review panel", async ({ mount }) => {
  const root = await mount("components-session-review--interactive-comments-panel")
  const comment = root.getByRole("button", { name: "Comment", exact: true, includeHidden: true })
  await expect(async () => {
    await root.getByText("export const first = 1", { exact: true }).hover()
    await expect(comment).toBeVisible()
  }).toPass()
  expect(await comment.evaluate((element) => (element as HTMLElement).style.background)).toBe(
    "var(--v2-background-bg-inverse)",
  )
  expect(await comment.evaluate((element) => (element as HTMLElement).style.left)).toBe("-4px")
  await expect(comment).toHaveCSS("z-index", "110")
  await expect
    .poll(async () => {
      const box = await comment.boundingBox()
      const gutterRight = await comment.evaluate(
        (element) => element.parentElement?.assignedSlot?.parentElement?.parentElement?.getBoundingClientRect().right,
      )
      return (box?.x ?? 0) + (box?.width ?? 0) - (gutterRight ?? 0)
    })
    .toBe(-4)
  await comment.dispatchEvent("click")
  await expect(root.getByRole("textbox")).toBeVisible()
  await expect(root.locator('[data-line="1"]')).toHaveAttribute("data-selected-line", /.*/)
})
