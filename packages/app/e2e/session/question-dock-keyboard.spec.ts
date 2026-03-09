import { test, expect } from "../fixtures"
import { seedSessionQuestion, withSession } from "../actions"
import { questionDockSelector, promptSelector } from "../selectors"

test.setTimeout(120_000)

test.describe("question dock keyboard navigation", () => {
  test("arrow up and arrow down navigate between options", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard arrows", async (session) => {
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
      await expect(options).toHaveCount(4)
      await expect(options.nth(0)).toBeFocused()

      for (const step of [
        { key: "ArrowDown", index: 1 },
        { key: "ArrowDown", index: 2 },
        { key: "ArrowDown", index: 3 },
        { key: "ArrowUp", index: 2 },
        { key: "ArrowUp", index: 1 },
        { key: "ArrowUp", index: 0 },
        { key: "ArrowUp", index: 3 },
        { key: "ArrowDown", index: 0 },
      ]) {
        await page.keyboard.press(step.key)
        await expect(options.nth(step.index)).toBeFocused()
      }
    })
  })

  test("arrow left and arrow right navigate between questions", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard left right", async (session) => {
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
      const options = dock.locator('[data-slot="question-option"]')

      await expect(dock.locator('[data-slot="question-text"]')).toHaveText("First question")
      await expect(options.nth(0)).toBeFocused()
      await page.keyboard.press("ArrowRight")
      await expect(dock.locator('[data-slot="question-text"]')).toHaveText("Second question")
      await expect(options.nth(0)).toBeFocused()
      await page.keyboard.press("ArrowRight")
      await expect(dock.locator('[data-slot="question-text"]')).toHaveText("Third question")
      await expect(options.nth(0)).toBeFocused()
      await page.keyboard.press("ArrowRight")
      await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(0)
      await expect(page.locator(promptSelector)).toBeVisible()
    })
  })

  test("enter selects an option", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard enter", async (session) => {
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
      await page.keyboard.press("ArrowDown")
      await expect(options.nth(1)).toBeFocused()
      await page.keyboard.press("Enter")
      await expect(options.nth(1)).toHaveAttribute("data-picked", "true")
      await page.keyboard.press("ArrowRight")
      await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(0)
    })
  })

  test("space selects an option", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard space", async (session) => {
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
      await expect(options.nth(0)).toBeFocused()
      await page.keyboard.press("Space")
      await expect(options.nth(0)).toHaveAttribute("data-picked", "true")
    })
  })

  test("home and end keys navigate options", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard home end", async (session) => {
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
      await expect(options).toHaveCount(5)
      await expect(options.nth(0)).toBeFocused()
      await page.keyboard.press("End")
      await expect(options.nth(4)).toBeFocused()
      await page.keyboard.press("Home")
      await expect(options.nth(0)).toBeFocused()
    })
  })

  test("multi-select with space toggles options", async ({ page, sdk, gotoSession }) => {
    await withSession(sdk, "e2e question dock keyboard multi", async (session) => {
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
      await page.keyboard.press("Space")
      await expect(options.nth(0)).toHaveAttribute("data-picked", "true")
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Space")
      await expect(options.nth(1)).toHaveAttribute("data-picked", "true")
      await expect(options.nth(0)).toHaveAttribute("data-picked", "true")
      await expect(options.nth(1)).toHaveAttribute("data-picked", "true")
      await page.keyboard.press("Space")
      await expect(options.nth(1)).toHaveAttribute("data-picked", "false")
      await expect(options.nth(0)).toHaveAttribute("data-picked", "true")
    })
  })
})
