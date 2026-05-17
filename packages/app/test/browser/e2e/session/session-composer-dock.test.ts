import { beforeAll, describe, expect, test } from "vitest"
import { By } from "selenium-webdriver"
import type { WebDriver } from "selenium-webdriver"
import {
  cleanupSession,
  clearSessionDockSeed,
  seedSessionQuestion,
  seedSessionTodos,
} from "../../../../e2e/actions"
import {
  permissionDockSelector,
  promptSelector,
  questionDockSelector,
  sessionComposerDockSelector,
  sessionTodoDockSelector,
  sessionTodoListSelector,
  sessionTodoToggleButtonSelector,
} from "../../../../e2e/selectors"
import {
  clearWdPermissionMock,
  ensureWdPermissionFetchShim,
  prepareWdPermissionMock,
} from "../../support/wd-permission-fetch-shim"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

type Sdk = Parameters<typeof clearSessionDockSeed>[0]

type PermissionRule = { permission: string; pattern: string; action: "allow" | "deny" | "ask" }

async function withDockSession<T>(
  sdk: Sdk,
  title: string,
  fn: (session: { id: string; title: string }) => Promise<T>,
  opts?: { permission?: PermissionRule[] },
) {
  const session = await sdk.session
    .create(opts?.permission ? { title, permission: opts.permission } : { title })
    .then((r) => r.data)
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

async function clearPermissionDock(driver: WebDriver, label: RegExp) {
  for (let i = 0; i < 3; i++) {
    const docks = await driver.findElements(By.css(permissionDockSelector))
    if (docks.length === 0) return
    const buttons = await docks[0]!.findElements(By.css("button"))
    for (const b of buttons) {
      const t = await b.getText()
      if (label.test(t)) {
        await b.click()
        await new Promise((r) => setTimeout(r, 150))
        break
      }
    }
  }
}

async function setAutoAccept(driver: WebDriver, enabled: boolean) {
  const button = await waitVisible(driver, By.css('[data-action="prompt-permissions"]'))
  const pressed = (await button.getAttribute("aria-pressed")) === "true"
  if (pressed === enabled) return
  await button.click()
  await driver.wait(async () => {
    const btn = await driver.findElement(By.css('[data-action="prompt-permissions"]'))
    const p = (await btn.getAttribute("aria-pressed")) === "true"
    return p === enabled
  }, 3000)
}

type MockReq = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  always?: string[]
}

async function withMockPermissionWd(
  driver: WebDriver,
  request: MockReq,
  child: Record<string, unknown> | undefined,
  fn: () => Promise<void>,
) {
  const pending = [
    {
      ...request,
      always: request.always ? request.always : ["*"],
      metadata: request.metadata ? request.metadata : {},
    },
  ]
  await prepareWdPermissionMock(driver, { pending, child })
  const url = await driver.getCurrentUrl()
  await driver.get(url)
  try {
    await fn()
  } finally {
    await clearWdPermissionMock(driver)
  }
}

describe("session composer dock (webdriver)", () => {
  const app = useAppWebDriver()

  beforeAll(async () => {
    await ensureWdPermissionFetchShim(app.driver)
  })

  test(
    "default dock shows prompt input",
    async () => {
      await withDockSession(app.sdk, "e2e composer dock default", async (session) => {
        await app.gotoSession(session.id)

        await waitVisible(app.driver, By.css(sessionComposerDockSelector))
        await waitVisible(app.driver, By.css(promptSelector))
        expect((await app.driver.findElements(By.css(questionDockSelector))).length).toBe(0)
        expect((await app.driver.findElements(By.css(permissionDockSelector))).length).toBe(0)

        const prompt = await waitVisible(app.driver, By.css(promptSelector))
        await prompt.click()
      })
    },
    120_000,
  )

  test("auto-accept toggle works before first submit", async () => {
    await app.gotoSession()

    const button = await waitVisible(app.driver, By.css('[data-action="prompt-permissions"]'))
    expect(await button.getAttribute("aria-pressed")).toBe("false")

    await setAutoAccept(app.driver, true)
    await setAutoAccept(app.driver, false)
  })

  test(
    "blocked question flow unblocks after submit",
    async () => {
      await withDockSession(app.sdk, "e2e composer dock question", async (session) => {
        await withDockSeed(app.sdk, session.id, async () => {
          await app.gotoSession(session.id)

          await seedSessionQuestion(app.sdk, {
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

          await app.driver.wait(async () => (await app.driver.findElements(By.css(questionDockSelector))).length === 1, 10_000)
          expect((await app.driver.findElements(By.css(promptSelector))).length).toBe(0)

          const dock = await waitVisible(app.driver, By.css(questionDockSelector))
          await dock.findElement(By.css('[data-slot="question-option"]')).click()
          await dock.findElement(By.xpath(`.//button[contains(translate(., "SUBMIT", "submit"), "submit")]`)).click()

          await app.driver.wait(async () => (await app.driver.findElements(By.css(questionDockSelector))).length === 0, 10_000)
          await waitVisible(app.driver, By.css(promptSelector))
        })
      })
    },
    120_000,
  )

  test(
    "blocked permission flow supports allow once",
    async () => {
      await withDockSession(app.sdk, "e2e composer dock permission once", async (session) => {
        await app.gotoSession(session.id)
        await setAutoAccept(app.driver, false)
        await withMockPermissionWd(
          app.driver,
          {
            id: "per_e2e_once",
            sessionID: session.id,
            permission: "bash",
            patterns: ["/tmp/opencode-e2e-perm-once"],
            metadata: { description: "Need permission for command" },
          },
          undefined,
          async () => {
            await app.driver.wait(async () => (await app.driver.findElements(By.css(permissionDockSelector))).length === 1, 10_000)
            expect((await app.driver.findElements(By.css(promptSelector))).length).toBe(0)

            await clearPermissionDock(app.driver, /allow once/i)
            await app.driver.get(await app.driver.getCurrentUrl())
            await app.driver.wait(async () => (await app.driver.findElements(By.css(permissionDockSelector))).length === 0, 10_000)
            await waitVisible(app.driver, By.css(promptSelector))
          },
        )
      })
    },
    120_000,
  )

  test(
    "blocked permission flow supports reject",
    async () => {
      await withDockSession(app.sdk, "e2e composer dock permission reject", async (session) => {
        await app.gotoSession(session.id)
        await setAutoAccept(app.driver, false)
        await withMockPermissionWd(
          app.driver,
          {
            id: "per_e2e_reject",
            sessionID: session.id,
            permission: "bash",
            patterns: ["/tmp/opencode-e2e-perm-reject"],
          },
          undefined,
          async () => {
            await app.driver.wait(async () => (await app.driver.findElements(By.css(permissionDockSelector))).length === 1, 10_000)
            expect((await app.driver.findElements(By.css(promptSelector))).length).toBe(0)

            await clearPermissionDock(app.driver, /deny/i)
            await app.driver.get(await app.driver.getCurrentUrl())
            await app.driver.wait(async () => (await app.driver.findElements(By.css(permissionDockSelector))).length === 0, 10_000)
            await waitVisible(app.driver, By.css(promptSelector))
          },
        )
      })
    },
    120_000,
  )

  test(
    "blocked permission flow supports allow always",
    async () => {
      await withDockSession(app.sdk, "e2e composer dock permission always", async (session) => {
        await app.gotoSession(session.id)
        await setAutoAccept(app.driver, false)
        await withMockPermissionWd(
          app.driver,
          {
            id: "per_e2e_always",
            sessionID: session.id,
            permission: "bash",
            patterns: ["/tmp/opencode-e2e-perm-always"],
            metadata: { description: "Need permission for command" },
          },
          undefined,
          async () => {
            await app.driver.wait(async () => (await app.driver.findElements(By.css(permissionDockSelector))).length === 1, 10_000)
            expect((await app.driver.findElements(By.css(promptSelector))).length).toBe(0)

            await clearPermissionDock(app.driver, /allow always/i)
            await app.driver.get(await app.driver.getCurrentUrl())
            await app.driver.wait(async () => (await app.driver.findElements(By.css(permissionDockSelector))).length === 0, 10_000)
            await waitVisible(app.driver, By.css(promptSelector))
          },
        )
      })
    },
    120_000,
  )

  test(
    "child session question request blocks parent dock and unblocks after submit",
    async () => {
      await withDockSession(app.sdk, "e2e composer dock child question parent", async (session) => {
        await app.gotoSession(session.id)

        const child = await app.sdk.session
          .create({
            title: "e2e composer dock child question",
            parentID: session.id,
          })
          .then((r) => r.data)
        if (!child?.id) throw new Error("Child session create did not return an id")

        try {
          await withDockSeed(app.sdk, child.id, async () => {
            await seedSessionQuestion(app.sdk, {
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

            await app.driver.wait(async () => (await app.driver.findElements(By.css(questionDockSelector))).length === 1, 10_000)
            expect((await app.driver.findElements(By.css(promptSelector))).length).toBe(0)

            const dock = await waitVisible(app.driver, By.css(questionDockSelector))
            await dock.findElement(By.css('[data-slot="question-option"]')).click()
            await dock.findElement(By.xpath(`.//button[contains(translate(., "SUBMIT", "submit"), "submit")]`)).click()

            await app.driver.wait(async () => (await app.driver.findElements(By.css(questionDockSelector))).length === 0, 10_000)
            await waitVisible(app.driver, By.css(promptSelector))
          })
        } finally {
          await cleanupSession({ sdk: app.sdk, sessionID: child.id })
        }
      })
    },
    120_000,
  )

  test(
    "child session permission request blocks parent dock and supports allow once",
    async () => {
      await withDockSession(app.sdk, "e2e composer dock child permission parent", async (session) => {
        await app.gotoSession(session.id)
        await setAutoAccept(app.driver, false)

        const child = await app.sdk.session
          .create({
            title: "e2e composer dock child permission",
            parentID: session.id,
          })
          .then((r) => r.data)
        if (!child?.id) throw new Error("Child session create did not return an id")

        try {
          await withMockPermissionWd(
            app.driver,
            {
              id: "per_e2e_child",
              sessionID: child.id,
              permission: "bash",
              patterns: ["/tmp/opencode-e2e-perm-child"],
              metadata: { description: "Need child permission" },
            },
            child as unknown as Record<string, unknown>,
            async () => {
              await app.driver.wait(async () => (await app.driver.findElements(By.css(permissionDockSelector))).length === 1, 10_000)
              expect((await app.driver.findElements(By.css(promptSelector))).length).toBe(0)

              await clearPermissionDock(app.driver, /allow once/i)
              await app.driver.get(await app.driver.getCurrentUrl())

              await app.driver.wait(async () => (await app.driver.findElements(By.css(permissionDockSelector))).length === 0, 10_000)
              await waitVisible(app.driver, By.css(promptSelector))
            },
          )
        } finally {
          await cleanupSession({ sdk: app.sdk, sessionID: child.id })
        }
      })
    },
    120_000,
  )

  test(
    "todo dock transitions and collapse behavior",
    async () => {
      await withDockSession(app.sdk, "e2e composer dock todo", async (session) => {
        await withDockSeed(app.sdk, session.id, async () => {
          await app.gotoSession(session.id)

          await seedSessionTodos(app.sdk, {
            sessionID: session.id,
            todos: [
              { content: "first task", status: "pending", priority: "high" },
              { content: "second task", status: "in_progress", priority: "medium" },
            ],
          })

          await app.driver.wait(async () => (await app.driver.findElements(By.css(sessionTodoDockSelector))).length === 1, 10_000)
          await waitVisible(app.driver, By.css(sessionTodoListSelector))

          await app.driver.findElement(By.css(sessionTodoToggleButtonSelector)).click()
          await app.driver.wait(async () => {
            const el = await app.driver.findElements(By.css(sessionTodoListSelector))
            if (el.length === 0) return true
            return !(await el[0]!.isDisplayed())
          }, 5000)

          await app.driver.findElement(By.css(sessionTodoToggleButtonSelector)).click()
          await waitVisible(app.driver, By.css(sessionTodoListSelector))

          await seedSessionTodos(app.sdk, {
            sessionID: session.id,
            todos: [
              { content: "first task", status: "completed", priority: "high" },
              { content: "second task", status: "cancelled", priority: "medium" },
            ],
          })

          await app.driver.wait(async () => (await app.driver.findElements(By.css(sessionTodoDockSelector))).length === 0, 10_000)
        })
      })
    },
    120_000,
  )

  test(
    "keyboard focus stays off prompt while blocked",
    async () => {
      await withDockSession(app.sdk, "e2e composer dock keyboard", async (session) => {
        await withDockSeed(app.sdk, session.id, async () => {
          await app.gotoSession(session.id)

          await seedSessionQuestion(app.sdk, {
            sessionID: session.id,
            questions: [
              {
                header: "Need input",
                question: "Pick one option",
                options: [{ label: "Continue", description: "Continue now" }],
              },
            ],
          })

          await app.driver.wait(async () => (await app.driver.findElements(By.css(questionDockSelector))).length === 1, 10_000)
          expect((await app.driver.findElements(By.css(promptSelector))).length).toBe(0)

          const main = await waitVisible(app.driver, By.css("main"))
          await app.driver.actions().move({ origin: main, x: 5, y: 5 }).click().perform()
          await app.driver.actions().sendKeys("abc").perform()
          expect((await app.driver.findElements(By.css(promptSelector))).length).toBe(0)
        })
      })
    },
    120_000,
  )
})
