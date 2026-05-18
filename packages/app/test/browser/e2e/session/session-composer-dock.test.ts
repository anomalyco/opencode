import type { Page, Route } from "playwright"
import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
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

async function clearPermissionDock(page: Page, label: RegExp) {
  const dock = page.locator(permissionDockSelector)
  for (let i = 0; i < 3; i++) {
    const c = await dock.count()
    if (c === 0) return
    await dock.getByRole("button", { name: label }).click()
    await new Promise((r) => setTimeout(r, 150))
  }
}

async function setAutoAccept(page: Page, enabled: boolean) {
  const button = page.locator('[data-action="prompt-permissions"]').first()
  await button.waitFor({ state: "visible" })
  const pressed = (await button.getAttribute("aria-pressed")) === "true"
  if (pressed === enabled) return
  await button.click()
  await expect
    .poll(async () => button.getAttribute("aria-pressed"))
    .toBe(enabled ? "true" : "false")
}

type MockReq = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  always?: string[]
}

async function withMockPermission<T>(
  page: Page,
  request: MockReq,
  opts: { child?: Record<string, unknown> } | undefined,
  fn: () => Promise<T>,
) {
  let pending: Record<string, unknown>[] = [
    {
      ...request,
      always: request.always ?? ["*"],
      metadata: request.metadata ?? {},
    },
  ]

  const list = async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pending),
    })
  }

  const reply = async (route: Route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split("/").pop()
    pending = pending.filter((item) => item.id !== id)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(true),
    })
  }

  await page.route("**/permission", list)
  await page.route("**/session/*/permissions/*", reply)

  const sessionList = opts?.child
    ? async (route: Route) => {
        const res = await route.fetch()
        const json = await res.json()
        let list: Record<string, unknown>[] | undefined
        if (Array.isArray(json)) list = json as Record<string, unknown>[]
        else if (json && typeof json === "object" && Array.isArray((json as { data?: unknown[] }).data))
          list = (json as { data: Record<string, unknown>[] }).data
        if (!list) {
          await route.fulfill({ response: res })
          return
        }
        const cid = (opts.child as { id?: string }).id
        if (!list.some((item) => item?.id === cid)) list.push(opts.child as Record<string, unknown>)
        const body = Array.isArray(json)
          ? JSON.stringify(list)
          : JSON.stringify({ ...(json as Record<string, unknown>), data: list })
        await route.fulfill({
          status: res.status(),
          headers: res.headers(),
          contentType: "application/json",
          body,
        })
      }
    : undefined

  if (sessionList) await page.route("**/session?*", sessionList)

  try {
    return await fn()
  } finally {
    await page.unroute("**/permission", list)
    await page.unroute("**/session/*/permissions/*", reply)
    if (sessionList) await page.unroute("**/session?*", sessionList)
  }
}

describe("session composer dock", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "default dock shows prompt input",
    async () => {
      await withDockSession(app.sdk, "e2e composer dock default", async (session) => {
        await app.gotoSession(session.id)
        const page = app.page

        await page.locator(sessionComposerDockSelector).waitFor({ state: "visible" })
        await page.locator(promptSelector).waitFor({ state: "visible" })
        expect(await page.locator(questionDockSelector).count()).toBe(0)
        expect(await page.locator(permissionDockSelector).count()).toBe(0)

        await page.locator(promptSelector).click()
        await expect
          .poll(async () =>
            page.locator(promptSelector).evaluate((el) => document.activeElement === el),
          )
          .toBe(true)
      })
    },
    120_000,
  )

  test("auto-accept toggle works before first submit", async () => {
    await app.gotoSession()
    const page = app.page

    const button = page.locator('[data-action="prompt-permissions"]').first()
    await button.waitFor({ state: "visible" })
    expect(await button.getAttribute("aria-pressed")).toBe("false")

    await setAutoAccept(page, true)
    await setAutoAccept(page, false)
  })

  test(
    "blocked question flow unblocks after submit",
    async () => {
      await withDockSession(app.sdk, "e2e composer dock question", async (session) => {
        await withDockSeed(app.sdk, session.id, async () => {
          await app.gotoSession(session.id)
          const page = app.page

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

          const dock = page.locator(questionDockSelector)
          await expect.poll(async () => await dock.count(), { timeout: 10_000 }).toBe(1)
          expect(await page.locator(promptSelector).count()).toBe(0)

          await dock.locator('[data-slot="question-option"]').first().click()
          await dock.getByRole("button", { name: /submit/i }).click()

          await expect.poll(async () => await page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)
          await page.locator(promptSelector).waitFor({ state: "visible" })
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
        const page = app.page
        await setAutoAccept(page, false)
        await withMockPermission(
          page,
          {
            id: "per_e2e_once",
            sessionID: session.id,
            permission: "bash",
            patterns: ["/tmp/opencode-e2e-perm-once"],
            metadata: { description: "Need permission for command" },
          },
          undefined,
          async () => {
            await page.goto(page.url())
            await expect.poll(async () => await page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(
              1,
            )
            expect(await page.locator(promptSelector).count()).toBe(0)

            await clearPermissionDock(page, /allow once/i)
            await page.goto(page.url())
            await expect.poll(async () => await page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(
              0,
            )
            await page.locator(promptSelector).waitFor({ state: "visible" })
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
        const page = app.page
        await setAutoAccept(page, false)
        await withMockPermission(
          page,
          {
            id: "per_e2e_reject",
            sessionID: session.id,
            permission: "bash",
            patterns: ["/tmp/opencode-e2e-perm-reject"],
          },
          undefined,
          async () => {
            await page.goto(page.url())
            await expect.poll(async () => await page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(
              1,
            )
            expect(await page.locator(promptSelector).count()).toBe(0)

            await clearPermissionDock(page, /deny/i)
            await page.goto(page.url())
            await expect.poll(async () => await page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(
              0,
            )
            await page.locator(promptSelector).waitFor({ state: "visible" })
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
        const page = app.page
        await setAutoAccept(page, false)
        await withMockPermission(
          page,
          {
            id: "per_e2e_always",
            sessionID: session.id,
            permission: "bash",
            patterns: ["/tmp/opencode-e2e-perm-always"],
            metadata: { description: "Need permission for command" },
          },
          undefined,
          async () => {
            await page.goto(page.url())
            await expect.poll(async () => await page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(
              1,
            )
            expect(await page.locator(promptSelector).count()).toBe(0)

            await clearPermissionDock(page, /allow always/i)
            await page.goto(page.url())
            await expect.poll(async () => await page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(
              0,
            )
            await page.locator(promptSelector).waitFor({ state: "visible" })
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
        const page = app.page

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

            const dock = page.locator(questionDockSelector)
            await expect.poll(async () => await dock.count(), { timeout: 10_000 }).toBe(1)
            expect(await page.locator(promptSelector).count()).toBe(0)

            await dock.locator('[data-slot="question-option"]').first().click()
            await dock.getByRole("button", { name: /submit/i }).click()

            await expect.poll(async () => await page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(0)
            await page.locator(promptSelector).waitFor({ state: "visible" })
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
        const page = app.page
        await setAutoAccept(page, false)

        const child = await app.sdk.session
          .create({
            title: "e2e composer dock child permission",
            parentID: session.id,
          })
          .then((r) => r.data)
        if (!child?.id) throw new Error("Child session create did not return an id")

        try {
          await withMockPermission(
            page,
            {
              id: "per_e2e_child",
              sessionID: child.id,
              permission: "bash",
              patterns: ["/tmp/opencode-e2e-perm-child"],
              metadata: { description: "Need child permission" },
            },
            { child: child as unknown as Record<string, unknown> },
            async () => {
              await page.goto(page.url())
              const dock = page.locator(permissionDockSelector)
              await expect.poll(async () => await dock.count(), { timeout: 10_000 }).toBe(1)
              expect(await page.locator(promptSelector).count()).toBe(0)

              await clearPermissionDock(page, /allow once/i)
              await page.goto(page.url())

              await expect.poll(async () => await page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(
                0,
              )
              await page.locator(promptSelector).waitFor({ state: "visible" })
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
          const page = app.page

          await seedSessionTodos(app.sdk, {
            sessionID: session.id,
            todos: [
              { content: "first task", status: "pending", priority: "high" },
              { content: "second task", status: "in_progress", priority: "medium" },
            ],
          })

          await expect.poll(async () => await page.locator(sessionTodoDockSelector).count(), { timeout: 10_000 }).toBe(
            1,
          )
          await page.locator(sessionTodoListSelector).waitFor({ state: "visible" })

          await page.locator(sessionTodoToggleButtonSelector).click()
          await expect.poll(async () => await page.locator(sessionTodoListSelector).isHidden()).toBe(true)

          await page.locator(sessionTodoToggleButtonSelector).click()
          await page.locator(sessionTodoListSelector).waitFor({ state: "visible" })

          await seedSessionTodos(app.sdk, {
            sessionID: session.id,
            todos: [
              { content: "first task", status: "completed", priority: "high" },
              { content: "second task", status: "cancelled", priority: "medium" },
            ],
          })

          await expect.poll(async () => await page.locator(sessionTodoDockSelector).count(), { timeout: 10_000 }).toBe(
            0,
          )
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
          const page = app.page

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

          await expect.poll(async () => await page.locator(questionDockSelector).count(), { timeout: 10_000 }).toBe(1)
          expect(await page.locator(promptSelector).count()).toBe(0)

          await page.locator("main").click({ position: { x: 5, y: 5 } })
          await page.keyboard.type("abc")
          expect(await page.locator(promptSelector).count()).toBe(0)
        })
      })
    },
    120_000,
  )
})
