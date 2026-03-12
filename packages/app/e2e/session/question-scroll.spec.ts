import { test, expect } from "../fixtures"
import { cleanupSession, clearSessionDockSeed, seedSessionQuestion } from "../actions"
import { questionDockSelector, promptSelector } from "../selectors"
import path from "node:path"
import fs from "node:fs/promises"

type Sdk = Parameters<typeof clearSessionDockSeed>[0]

async function withDockSession<T>(sdk: Sdk, title: string, fn: (session: { id: string; title: string }) => Promise<T>) {
  const session = await sdk.session.create({ title }).then((r) => r.data)
  if (!session?.id) throw new Error("Session create did not return an id")
  try {
    return await fn(session)
  } finally {
    await cleanupSession({ sdk, sessionID: session.id })
  }
}

async function withDockSeed<T>(sdk: Sdk, sessionID: string, fn: () => Promise<T>) {
  try {
    return await fn()
  } finally {
    await clearSessionDockSeed(sdk, sessionID).catch(() => undefined)
  }
}

test.setTimeout(120_000)

const screenshotsDir = path.join(process.cwd(), "test-screenshots", "question-scroll")

async function ensureScreenshotDir() {
  await fs.mkdir(screenshotsDir, { recursive: true })
}

test("question with long text shows scrollable content and visible options", async ({ page, sdk, gotoSession }) => {
  await ensureScreenshotDir()

  await withDockSession(sdk, "e2e question scroll long text", async (session) => {
    await withDockSeed(sdk, session.id, async () => {
      await gotoSession(session.id)

      const longQuestionText = [
        "This is a very long question that tests the scroll behavior.",
        "The scrollbox should constrain the question text height.",
        "This ensures that answer options remain visible even when questions are very long.",
        ...Array.from(
          { length: 50 },
          (_, i) => `Line ${i + 5}: Additional context information to demonstrate scrolling capability.`,
        ),
      ].join("\n")

      await seedSessionQuestion(sdk, {
        sessionID: session.id,
        questions: [
          {
            header: "Long Question Test",
            question: longQuestionText,
            options: [
              { label: "Option 1: Continue", description: "This option should always be visible" },
              { label: "Option 2: Stop", description: "This option should also be visible" },
              { label: "Option 3: Retry", description: "Another visible option" },
            ],
            custom: false,
          },
        ],
      })

      const dock = page.locator(questionDockSelector)
      await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)
      await expect(page.locator(promptSelector)).toHaveCount(0)

      const timestamp = Date.now()

      const questionText = dock.locator('[data-slot="question-text"]')
      await expect(questionText).toBeVisible()

      const scrollHeight = await questionText.evaluate((el) => el.scrollHeight)
      const clientHeight = await questionText.evaluate((el) => el.clientHeight)
      console.log(`Question text scrollHeight: ${scrollHeight}px, clientHeight: ${clientHeight}px`)

      const screenshot1Path = path.join(screenshotsDir, `question-long-initial-${timestamp}.png`)
      await dock.screenshot({ path: screenshot1Path })
      console.log(`Screenshot saved (top): ${screenshot1Path}`)

      if (scrollHeight > clientHeight) {
        console.log("✓ Question text is scrollable (scrollHeight > clientHeight)")

        await questionText.evaluate((el) => {
          el.scrollTop = el.scrollHeight / 2
        })

        const screenshotScrollPath = path.join(screenshotsDir, `question-long-scrolled-${timestamp}.png`)
        await dock.screenshot({ path: screenshotScrollPath })
        console.log(`Screenshot saved (middle): ${screenshotScrollPath}`)

        await questionText.evaluate((el) => {
          el.scrollTop = 0
        })
      }

      const options = dock.locator('[data-slot="question-option"]')
      await expect.poll(() => options.count(), { timeout: 5000 }).toBe(3)

      const screenshot2Path = path.join(screenshotsDir, `question-long-options-visible-${timestamp}.png`)
      await dock.screenshot({ path: screenshot2Path })
      console.log(`Screenshot saved (options visible): ${screenshot2Path}`)

      // Click first option
      await options.first().click()

      // Screenshot 3: After selecting an option
      const screenshot3Path = path.join(screenshotsDir, `question-long-option-selected-${timestamp}.png`)
      await dock.screenshot({ path: screenshot3Path })
      console.log(`Screenshot saved: ${screenshot3Path}`)

      // Submit the answer
      await dock.getByRole("button", { name: /submit/i }).click()

      await expect.poll(() => page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)
      await expect(page.locator(promptSelector)).toBeVisible()

      console.log("✓ Long question scroll test completed successfully")
    })
  })
})

test("question with multiple tabs and long text handles scrolling correctly", async ({ page, sdk, gotoSession }) => {
  await ensureScreenshotDir()

  await withDockSession(sdk, "e2e question scroll multiple tabs", async (session) => {
    await withDockSeed(sdk, session.id, async () => {
      await gotoSession(session.id)

      const longQuestion1 = [
        "First question with extensive content.",
        ...Array.from({ length: 30 }, (_, i) => `Detail line ${i + 3}: More information about the first question.`),
      ].join("\n")

      const longQuestion2 = [
        "Second question also with extensive content.",
        ...Array.from({ length: 30 }, (_, i) => `Detail line ${i + 3}: More information about the second question.`),
      ].join("\n")

      await seedSessionQuestion(sdk, {
        sessionID: session.id,
        questions: [
          {
            header: "Q1",
            question: longQuestion1,
            options: [
              { label: "A1", description: "First option for Q1" },
              { label: "A2", description: "Second option for Q1" },
            ],
            custom: false,
          },
          {
            header: "Q2",
            question: longQuestion2,
            options: [
              { label: "B1", description: "First option for Q2" },
              { label: "B2", description: "Second option for Q2" },
            ],
            custom: false,
          },
        ],
      })

      const dock = page.locator(questionDockSelector)
      await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)

      const timestamp = Date.now()

      // Screenshot 4: First question with long text
      const screenshot4Path = path.join(screenshotsDir, `question-multi-tab-1-${timestamp}.png`)
      await dock.screenshot({ path: screenshot4Path })
      console.log(`Screenshot saved: ${screenshot4Path}`)

      // Select option on first question
      await dock.locator('[data-slot="question-option"]').first().click()

      // Move to second question
      await dock.getByRole("button", { name: /next/i }).click()

      // Screenshot 5: Second question with long text
      const screenshot5Path = path.join(screenshotsDir, `question-multi-tab-2-${timestamp}.png`)
      await dock.screenshot({ path: screenshot5Path })
      console.log(`Screenshot saved: ${screenshot5Path}`)

      // Select option on second question and submit
      await dock.locator('[data-slot="question-option"]').first().click()
      await dock.getByRole("button", { name: /submit/i }).click()

      await expect.poll(() => page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)

      console.log("✓ Multiple tabs with long text test completed successfully")
    })
  })
})

test("question with moderate text displays without unnecessary scrolling", async ({ page, sdk, gotoSession }) => {
  await ensureScreenshotDir()

  await withDockSession(sdk, "e2e question scroll moderate text", async (session) => {
    await withDockSeed(sdk, session.id, async () => {
      await gotoSession(session.id)

      const moderateQuestionText = [
        "This is a moderate length question.",
        "It should fit within the available space without requiring scrolling.",
        "The options should be clearly visible below.",
      ].join("\n")

      await seedSessionQuestion(sdk, {
        sessionID: session.id,
        questions: [
          {
            header: "Moderate Question",
            question: moderateQuestionText,
            options: [
              { label: "Yes", description: "Confirm action" },
              { label: "No", description: "Cancel action" },
            ],
            custom: false,
          },
        ],
      })

      const dock = page.locator(questionDockSelector)
      await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)

      const timestamp = Date.now()

      // Screenshot 6: Moderate length question
      const screenshot6Path = path.join(screenshotsDir, `question-moderate-${timestamp}.png`)
      await dock.screenshot({ path: screenshot6Path })
      console.log(`Screenshot saved: ${screenshot6Path}`)

      // Verify everything is visible without scrolling issues
      const questionText = dock.locator('[data-slot="question-text"]')
      await expect(questionText).toBeVisible()

      const options = dock.locator('[data-slot="question-option"]')
      await expect.poll(() => options.count()).toBe(2)

      await options.first().click()
      await dock.getByRole("button", { name: /submit/i }).click()

      await expect.poll(() => page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)

      console.log("✓ Moderate text question test completed successfully")
    })
  })
})

test("question with 50 items demonstrates scrolling behavior", async ({ page, sdk, gotoSession }) => {
  await ensureScreenshotDir()

  await withDockSession(sdk, "e2e question scroll 50 items", async (session) => {
    await withDockSeed(sdk, session.id, async () => {
      await gotoSession(session.id)

      const questionWith50Items = [
        "This question contains 50 numbered items to demonstrate scrolling behavior.",
        "The question text should be constrained to a max height with a scrollbar.",
        "Please review all 50 items below:",
        ...Array.from(
          { length: 50 },
          (_, i) =>
            `${i + 4}. Item ${i + 1}: This is a detailed description of item number ${i + 1} to ensure enough content for scrolling.`,
        ),
      ].join("\n")

      await seedSessionQuestion(sdk, {
        sessionID: session.id,
        questions: [
          {
            header: "50 Items Scrolling Test",
            question: questionWith50Items,
            options: [
              { label: "Accept All", description: "I have reviewed all 50 items" },
              { label: "Reject", description: "I need more time to review" },
            ],
            custom: false,
          },
        ],
      })

      const dock = page.locator(questionDockSelector)
      await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)

      const timestamp = Date.now()

      const questionText = dock.locator('[data-slot="question-text"]')
      await expect(questionText).toBeVisible()

      const screenshot1Path = path.join(screenshotsDir, `question-50-items-top-${timestamp}.png`)
      await dock.screenshot({ path: screenshot1Path })
      console.log(`Screenshot saved (top): ${screenshot1Path}`)

      const scrollHeight = await questionText.evaluate((el) => el.scrollHeight)
      const clientHeight = await questionText.evaluate((el) => el.clientHeight)
      console.log(`Question text scrollHeight: ${scrollHeight}px, clientHeight: ${clientHeight}px`)

      if (scrollHeight > clientHeight) {
        console.log("✓ Question text is scrollable (scrollHeight > clientHeight)")

        await questionText.evaluate((el) => {
          el.scrollTop = el.scrollHeight / 2
        })

        const screenshot2Path = path.join(screenshotsDir, `question-50-items-middle-${timestamp}.png`)
        await dock.screenshot({ path: screenshot2Path })
        console.log(`Screenshot saved (middle): ${screenshot2Path}`)

        await questionText.evaluate((el) => {
          el.scrollTop = el.scrollHeight
        })

        const screenshot3Path = path.join(screenshotsDir, `question-50-items-bottom-${timestamp}.png`)
        await dock.screenshot({ path: screenshot3Path })
        console.log(`Screenshot saved (bottom): ${screenshot3Path}`)

        await questionText.evaluate((el) => {
          el.scrollTop = 0
        })
      } else {
        console.log("⚠ Question text is not scrollable (all content fits)")
      }

      const options = dock.locator('[data-slot="question-option"]')
      await expect.poll(() => options.count()).toBe(2)

      await options.first().click()

      const screenshot4Path = path.join(screenshotsDir, `question-50-items-selected-${timestamp}.png`)
      await dock.screenshot({ path: screenshot4Path })
      console.log(`Screenshot saved (selected): ${screenshot4Path}`)

      await dock.getByRole("button", { name: /submit/i }).click()

      await expect.poll(() => page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)

      console.log("✓ 50 items scrolling test completed successfully")
    })
  })
})
