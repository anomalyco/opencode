import { test, expect } from "../fixtures"
import { clearSessionDockSeed, seedSessionQuestion, withSession } from "../actions"
import { questionDockSelector, promptSelector } from "../selectors"

type Sdk = Parameters<typeof clearSessionDockSeed>[0]

async function withDockSeed<T>(sdk: Sdk, sessionID: string, fn: () => Promise<T>) {
  try {
    return await fn()
  } finally {
    await clearSessionDockSeed(sdk, sessionID).catch(() => undefined)
  }
}

test.setTimeout(120_000)

test.describe("question dock keyboard navigation", () => {
  test("ArrowUp and ArrowDown navigate between options", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard arrows", async (session) => {
      await withDockSeed(sdk, session.id, async () => {
        await gotoSession(session.id)

        await seedSessionQuestion(sdk, {
          sessionID: session.id,
          questions: [
            {
              header: "Keyboard test",
              question: "Pick an option",
              options: [
                { label: "Option A", description: "First option" },
                { label: "Option B", description: "Second option" },
                { label: "Option C", description: "Third option" },
              ],
            },
          ],
        })

        const dock = page.locator(questionDockSelector)
        await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)

        const options = dock.locator('[data-slot="question-option"]')
        await expect(options).toHaveCount(4) // 3 options + custom input

        // First option should be auto-focused
        await expect(options.nth(0)).toBeFocused()

        // Arrow Down should move to next option
        await page.keyboard.press("ArrowDown")
        await expect(options.nth(1)).toBeFocused()

        // Arrow Down again
        await page.keyboard.press("ArrowDown")
        await expect(options.nth(2)).toBeFocused()

        // Arrow Down should wrap to first or go to custom option
        await page.keyboard.press("ArrowDown")
        await expect(options.nth(3)).toBeFocused()

        // Arrow Up should go back
        await page.keyboard.press("ArrowUp")
        await expect(options.nth(2)).toBeFocused()

        // Arrow Up again
        await page.keyboard.press("ArrowUp")
        await expect(options.nth(1)).toBeFocused()

        // Arrow Up to first
        await page.keyboard.press("ArrowUp")
        await expect(options.nth(0)).toBeFocused()

        // Arrow Up at first option should wrap to last
        await page.keyboard.press("ArrowUp")
        await expect(options.nth(3)).toBeFocused()

        // Arrow Down at last option should wrap to first
        await page.keyboard.press("ArrowDown")
        await expect(options.nth(0)).toBeFocused()
      })
    })
  })

  test("ArrowLeft and ArrowRight navigate between questions", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard left right", async (session) => {
      await withDockSeed(sdk, session.id, async () => {
        await gotoSession(session.id)

        await seedSessionQuestion(sdk, {
          sessionID: session.id,
          questions: [
            {
              header: "Question 1",
              question: "First question",
              options: [{ label: "Answer 1", description: "First answer" }],
            },
            {
              header: "Question 2",
              question: "Second question",
              options: [{ label: "Answer 2", description: "Second answer" }],
            },
            {
              header: "Question 3",
              question: "Third question",
              options: [{ label: "Answer 3", description: "Third answer" }],
            },
          ],
        })

        const dock = page.locator(questionDockSelector)
        await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)

        // Verify starting at question 1
        await expect(dock.locator('[data-slot="question-text"]')).toHaveText("First question")

        // Arrow Right should go to next question
        await page.keyboard.press("ArrowRight")
        await expect(dock.locator('[data-slot="question-text"]')).toHaveText("Second question")

        // Arrow Right again to question 3
        await page.keyboard.press("ArrowRight")
        await expect(dock.locator('[data-slot="question-text"]')).toHaveText("Third question")

        // Arrow Right at last question should submit
        await page.keyboard.press("ArrowRight")

        // Dock should be gone after submit
        await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(0)
        await expect(page.locator(promptSelector)).toBeVisible()
      })
    })
  })

  test("Enter selects an option", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard enter", async (session) => {
      await withDockSeed(sdk, session.id, async () => {
        await gotoSession(session.id)

        await seedSessionQuestion(sdk, {
          sessionID: session.id,
          questions: [
            {
              header: "Enter test",
              question: "Pick one",
              options: [
                { label: "Yes", description: "Continue" },
                { label: "No", description: "Stop" },
              ],
            },
          ],
        })

        const dock = page.locator(questionDockSelector)
        await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)

        const options = dock.locator('[data-slot="question-option"]')

        // Move to second option
        await page.keyboard.press("ArrowDown")
        await expect(options.nth(1)).toBeFocused()

        // Enter to select
        await page.keyboard.press("Enter")

        // Option should be selected (data-picked="true")
        await expect(options.nth(1)).toHaveAttribute("data-picked", "true")

        // Navigate to submit
        await page.keyboard.press("ArrowRight")

        // Dock should be gone after submit
        await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(0)
      })
    })
  })

  test("Space selects an option", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard space", async (session) => {
      await withDockSeed(sdk, session.id, async () => {
        await gotoSession(session.id)

        await seedSessionQuestion(sdk, {
          sessionID: session.id,
          questions: [
            {
              header: "Space test",
              question: "Pick one",
              options: [
                { label: "Continue", description: "Keep going" },
                { label: "Exit", description: "Stop now" },
              ],
            },
          ],
        })

        const dock = page.locator(questionDockSelector)
        await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)

        const options = dock.locator('[data-slot="question-option"]')

        // Move to first option
        await expect(options.nth(0)).toBeFocused()

        // Space to select
        await page.keyboard.press("Space")

        // Option should be selected
        await expect(options.nth(0)).toHaveAttribute("data-picked", "true")
      })
    })
  })

  test("Home and End keys navigate options", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard home end", async (session) => {
      await withDockSeed(sdk, session.id, async () => {
        await gotoSession(session.id)

        await seedSessionQuestion(sdk, {
          sessionID: session.id,
          questions: [
            {
              header: "Home End test",
              question: "Navigate options",
              options: [
                { label: "First", description: "1st" },
                { label: "Second", description: "2nd" },
                { label: "Third", description: "3rd" },
                { label: "Fourth", description: "4th" },
              ],
            },
          ],
        })

        const dock = page.locator(questionDockSelector)
        await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)

        const options = dock.locator('[data-slot="question-option"]')
        await expect(options).toHaveCount(5) // 4 options + custom

        // First option focused by default
        await expect(options.nth(0)).toBeFocused()

        // End key should go to last option
        await page.keyboard.press("End")
        await expect(options.nth(4)).toBeFocused()

        // Home key should go to first option
        await page.keyboard.press("Home")
        await expect(options.nth(0)).toBeFocused()
      })
    })
  })

  test("multi-select with Space toggles options", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard multi", async (session) => {
      await withDockSeed(sdk, session.id, async () => {
        await gotoSession(session.id)

        await seedSessionQuestion(sdk, {
          sessionID: session.id,
          questions: [
            {
              header: "Multi test",
              question: "Pick multiple",
              options: [
                { label: "Red", description: "Color red" },
                { label: "Green", description: "Color green" },
                { label: "Blue", description: "Color blue" },
              ],
              multiple: true,
            },
          ],
        })

        const dock = page.locator(questionDockSelector)
        await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)

        const options = dock.locator('[data-slot="question-option"]')

        // Select first option
        await page.keyboard.press("Space")
        await expect(options.nth(0)).toHaveAttribute("data-picked", "true")

        // Move to second and select
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Space")
        await expect(options.nth(1)).toHaveAttribute("data-picked", "true")

        // Both should be selected
        await expect(options.nth(0)).toHaveAttribute("data-picked", "true")
        await expect(options.nth(1)).toHaveAttribute("data-picked", "true")

        // Toggle second off
        await page.keyboard.press("Space")
        await expect(options.nth(1)).toHaveAttribute("data-picked", "false")
        await expect(options.nth(0)).toHaveAttribute("data-picked", "true")
      })
    })
  })
})
