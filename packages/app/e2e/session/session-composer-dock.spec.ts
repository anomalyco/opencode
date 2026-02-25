import { test, expect } from "../fixtures"
import { clearSessionDockSeed, seedSessionPermission, seedSessionQuestion, seedSessionTodos } from "../actions"
import {
  permissionDockSelector,
  promptSelector,
  questionDockSelector,
  sessionComposerDockSelector,
  sessionTodoDockSelector,
  sessionTodoListSelector,
  sessionTodoToggleButtonSelector,
} from "../selectors"

type Sdk = Parameters<typeof clearSessionDockSeed>[0]

async function withDockSession<T>(sdk: Sdk, title: string, fn: (session: { id: string; title: string }) => Promise<T>) {
  const session = await sdk.session.create({ title }).then((r) => r.data)
  if (!session?.id) throw new Error("Session create did not return an id")
  try {
    return await fn(session)
  } finally {
    await sdk.session.delete({ sessionID: session.id }).catch(() => undefined)
  }
}

test.setTimeout(120_000)

async function withDockSeed<T>(sdk: Sdk, sessionID: string, fn: () => Promise<T>) {
  try {
    return await fn()
  } finally {
    await clearSessionDockSeed(sdk, sessionID).catch(() => undefined)
  }
}

test("default dock shows prompt input", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock default", async (session) => {
    await gotoSession(session.id)

    await expect(page.locator(sessionComposerDockSelector)).toBeVisible()
    await expect(page.locator(promptSelector)).toBeVisible()
    await expect(page.locator(questionDockSelector)).toHaveCount(0)
    await expect(page.locator(permissionDockSelector)).toHaveCount(0)

    await page.locator(promptSelector).click()
    await expect(page.locator(promptSelector)).toBeFocused()
  })
})

test("blocked question flow unblocks after submit", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock question", async (session) => {
    await withDockSeed(sdk, session.id, async () => {
      await gotoSession(session.id)

      await seedSessionQuestion(sdk, {
        sessionID: session.id,
        questions: [
          {
            header: "Need input",
            question: "Pick one option",
            options: [
              { label: "Continue", description: "Continue now" },
              { label: "Stop", description: "Stop here" },
            ],
          },
        ],
      })

      const dock = page.locator(questionDockSelector)
      await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)
      await expect(page.locator(promptSelector)).toHaveCount(0)

      await dock.locator('[data-slot="question-option"]').first().click()
      await dock.getByRole("button", { name: /submit/i }).click()

      await expect.poll(() => page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)
      await expect(page.locator(promptSelector)).toBeVisible()
    })
  })
})

test("blocked permission flow supports allow once", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock permission once", async (session) => {
    await withDockSeed(sdk, session.id, async () => {
      await gotoSession(session.id)

      await seedSessionPermission(sdk, {
        sessionID: session.id,
        permission: "bash",
        patterns: ["README.md"],
        description: "Need permission for command",
      })

      await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(1)
      await expect(page.locator(promptSelector)).toHaveCount(0)

      await page
        .locator(permissionDockSelector)
        .getByRole("button", { name: /allow once/i })
        .click()
      await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(0)
      await expect(page.locator(promptSelector)).toBeVisible()
    })
  })
})

test("blocked permission flow supports reject", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock permission reject", async (session) => {
    await withDockSeed(sdk, session.id, async () => {
      await gotoSession(session.id)

      await seedSessionPermission(sdk, {
        sessionID: session.id,
        permission: "bash",
        patterns: ["REJECT.md"],
      })

      await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(1)
      await expect(page.locator(promptSelector)).toHaveCount(0)

      await page.locator(permissionDockSelector).getByRole("button", { name: /deny/i }).click()
      await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(0)
      await expect(page.locator(promptSelector)).toBeVisible()
    })
  })
})

test("blocked permission flow supports allow always", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock permission always", async (session) => {
    await withDockSeed(sdk, session.id, async () => {
      await gotoSession(session.id)

      await seedSessionPermission(sdk, {
        sessionID: session.id,
        permission: "bash",
        patterns: ["README.md"],
        description: "Need permission for command",
      })

      await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(1)
      await expect(page.locator(promptSelector)).toHaveCount(0)

      await page
        .locator(permissionDockSelector)
        .getByRole("button", { name: /allow always/i })
        .click()
      await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(0)
      await expect(page.locator(promptSelector)).toBeVisible()
    })
  })
})

test("child session question request blocks parent dock and unblocks after submit", async ({
  page,
  sdk,
  gotoSession,
}) => {
  await withDockSession(sdk, "e2e composer dock child question parent", async (session) => {
    await gotoSession(session.id)

    const child = await sdk.session
      .create({
        title: "e2e composer dock child question",
        parentID: session.id,
      })
      .then((r) => r.data)
    if (!child?.id) throw new Error("Child session create did not return an id")

    try {
      await withDockSeed(sdk, child.id, async () => {
        await seedSessionQuestion(sdk, {
          sessionID: child.id,
          questions: [
            {
              header: "Child input",
              question: "Pick one child option",
              options: [
                { label: "Continue", description: "Continue child" },
                { label: "Stop", description: "Stop child" },
              ],
            },
          ],
        })

        const dock = page.locator(questionDockSelector)
        await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)
        await expect(page.locator(promptSelector)).toHaveCount(0)

        await dock.locator('[data-slot="question-option"]').first().click()
        await dock.getByRole("button", { name: /submit/i }).click()

        await expect.poll(() => page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)
        await expect(page.locator(promptSelector)).toBeVisible()
      })
    } finally {
      await sdk.session.delete({ sessionID: child.id }).catch(() => undefined)
    }
  })
})

test("child session permission request blocks parent dock and supports allow once", async ({
  page,
  sdk,
  gotoSession,
}) => {
  await withDockSession(sdk, "e2e composer dock child permission parent", async (session) => {
    await gotoSession(session.id)

    const child = await sdk.session
      .create({
        title: "e2e composer dock child permission",
        parentID: session.id,
        permission: [{ permission: "read", pattern: "*", action: "ask" }],
      })
      .then((r) => r.data)
    if (!child?.id) throw new Error("Child session create did not return an id")

    try {
      await withDockSeed(sdk, child.id, async () => {
        await seedSessionPermission(sdk, {
          sessionID: child.id,
          permission: "read",
          patterns: ["README.md"],
          description: "Need child permission",
        })

        const dock = page.locator(permissionDockSelector)
        await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)
        await expect(page.locator(promptSelector)).toHaveCount(0)

        await dock.getByRole("button", { name: /allow once/i }).click()

        await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(0)
        await expect(page.locator(promptSelector)).toBeVisible()
      })
    } finally {
      await sdk.session.delete({ sessionID: child.id }).catch(() => undefined)
    }
  })
})

test("todo dock transitions and collapse behavior", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock todo", async (session) => {
    await withDockSeed(sdk, session.id, async () => {
      await gotoSession(session.id)

      await seedSessionTodos(sdk, {
        sessionID: session.id,
        todos: [
          { content: "first task", status: "pending", priority: "high" },
          { content: "second task", status: "in_progress", priority: "medium" },
        ],
      })

      await expect.poll(() => page.locator(sessionTodoDockSelector).count(), { timeout: 10_000 }).toBe(1)
      await expect(page.locator(sessionTodoListSelector)).toBeVisible()

      await page.locator(sessionTodoToggleButtonSelector).click()
      await expect(page.locator(sessionTodoListSelector)).toBeHidden()

      await page.locator(sessionTodoToggleButtonSelector).click()
      await expect(page.locator(sessionTodoListSelector)).toBeVisible()

      await seedSessionTodos(sdk, {
        sessionID: session.id,
        todos: [
          { content: "first task", status: "completed", priority: "high" },
          { content: "second task", status: "cancelled", priority: "medium" },
        ],
      })

      await expect.poll(() => page.locator(sessionTodoDockSelector).count(), { timeout: 10_000 }).toBe(0)
    })
  })
})

test("keyboard focus stays off prompt while blocked", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock keyboard", async (session) => {
    await withDockSeed(sdk, session.id, async () => {
      await gotoSession(session.id)

      await seedSessionQuestion(sdk, {
        sessionID: session.id,
        questions: [
          {
            header: "Need input",
            question: "Pick one option",
            options: [{ label: "Continue", description: "Continue now" }],
          },
        ],
      })

      await expect.poll(() => page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(1)
      await expect(page.locator(promptSelector)).toHaveCount(0)

      await page.locator("main").click({ position: { x: 5, y: 5 } })
      await page.keyboard.type("abc")
      await expect(page.locator(promptSelector)).toHaveCount(0)
    })
  })
})
