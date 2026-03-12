import { test, expect } from "../fixtures"
import { cleanupSession, clearSessionDockSeed, seedSessionQuestion } from "../actions"
import { questionDockSelector, promptSelector } from "../selectors"

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

test("question with long text shows scrollable content and visible options", async ({ page, sdk, gotoSession }) => {
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

      const questionText = dock.locator('[data-slot="question-text"]')
      await expect(questionText).toBeVisible()

      await page.waitForTimeout(250)

      const scrollHeight = await questionText.evaluate((el) => el.scrollHeight)
      const clientHeight = await questionText.evaluate((el) => el.clientHeight)

      expect(scrollHeight).toBeGreaterThan(clientHeight)

      await questionText.evaluate((el) => {
        el.scrollTop = el.scrollHeight / 2
      })

      await page.waitForTimeout(100)

      await questionText.evaluate((el) => {
        el.scrollTop = 0
      })

      await page.waitForTimeout(100)

      const options = dock.locator('[data-slot="question-option"]')
      await expect.poll(() => options.count(), { timeout: 5000 }).toBe(3)

      await options.first().click()
      await dock.getByRole("button", { name: /submit/i }).click()

      await expect.poll(() => page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)
      await expect(page.locator(promptSelector)).toBeVisible()
    })
  })
})

test("question with multiple tabs and long text handles scrolling correctly", async ({ page, sdk, gotoSession }) => {
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

      const questionText = dock.locator('[data-slot="question-text"]')
      await expect(questionText).toBeVisible()

      await page.waitForTimeout(250)

      await dock.locator('[data-slot="question-option"]').first().click()
      await dock.getByRole("button", { name: /next/i }).click()

      await expect(questionText).toBeVisible()
      await page.waitForTimeout(250)

      await dock.locator('[data-slot="question-option"]').first().click()
      await dock.getByRole("button", { name: /submit/i }).click()

      await expect.poll(() => page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)
    })
  })
})

test("question with moderate text displays without unnecessary scrolling", async ({ page, sdk, gotoSession }) => {
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

      const questionText = dock.locator('[data-slot="question-text"]')
      await expect(questionText).toBeVisible()

      await page.waitForTimeout(250)

      const scrollHeight = await questionText.evaluate((el) => el.scrollHeight)
      const clientHeight = await questionText.evaluate((el) => el.clientHeight)
      expect(scrollHeight).toBe(clientHeight)

      const options = dock.locator('[data-slot="question-option"]')
      await expect.poll(() => options.count()).toBe(2)

      await options.first().click()
      await dock.getByRole("button", { name: /submit/i }).click()

      await expect.poll(() => page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)
    })
  })
})

test("question with 50 items demonstrates scrolling behavior", async ({ page, sdk, gotoSession }) => {
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

      const questionText = dock.locator('[data-slot="question-text"]')
      await expect(questionText).toBeVisible()

      await page.waitForTimeout(250)

      const scrollHeight = await questionText.evaluate((el) => el.scrollHeight)
      const clientHeight = await questionText.evaluate((el) => el.clientHeight)
      expect(scrollHeight).toBeGreaterThan(clientHeight)

      await questionText.evaluate((el) => {
        el.scrollTop = el.scrollHeight / 2
      })

      await page.waitForTimeout(100)

      await questionText.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })

      await page.waitForTimeout(100)

      await questionText.evaluate((el) => {
        el.scrollTop = 0
      })

      await page.waitForTimeout(100)

      const options = dock.locator('[data-slot="question-option"]')
      await expect.poll(() => options.count()).toBe(2)

      await options.first().click()
      await dock.getByRole("button", { name: /submit/i }).click()

      await expect.poll(() => page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)
    })
  })
})
