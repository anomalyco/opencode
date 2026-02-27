import { test, expect } from "../fixtures"
import { clearSessionDockSeed, seedSessionQuestion, seedSessionTodos } from "../actions"
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

async function clearPermissionDock(page: any, label: RegExp) {
  const dock = page.locator(permissionDockSelector)
  for (let i = 0; i < 3; i++) {
    const count = await dock.count()
    if (count === 0) return
    await dock.getByRole("button", { name: label }).click()
    await page.waitForTimeout(150)
  }
}

async function setAutoAccept(page: any, enabled: boolean) {
  const button = page.locator('[data-action="prompt-permissions"]').first()
  await expect(button).toBeVisible()
  const pressed = (await button.getAttribute("aria-pressed")) === "true"
  if (pressed === enabled) return
  await button.click()
  await expect(button).toHaveAttribute("aria-pressed", enabled ? "true" : "false")
}

async function withMockPermission<T>(
  page: any,
  request: {
    id: string
    sessionID: string
    permission: string
    patterns: string[]
    metadata?: Record<string, unknown>
    always?: string[]
  },
  opts: { child?: any } | undefined,
  fn: () => Promise<T>,
) {
  let pending = [
    {
      ...request,
      always: request.always ?? ["*"],
      metadata: request.metadata ?? {},
    },
  ]

  const list = async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pending),
    })
  }

  const reply = async (route: any) => {
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
    ? async (route: any) => {
        const res = await route.fetch()
        const json = await res.json()
        const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : undefined
        if (Array.isArray(list) && !list.some((item) => item?.id === opts.child?.id)) list.push(opts.child)
        await route.fulfill({
          status: res.status(),
          headers: res.headers(),
          contentType: "application/json",
          body: JSON.stringify(json),
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
    await gotoSession(session.id)
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
        await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(1)
        await expect(page.locator(promptSelector)).toHaveCount(0)

        await clearPermissionDock(page, /allow once/i)
        await page.goto(page.url())
        await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(0)
        await expect(page.locator(promptSelector)).toBeVisible()
      },
    )
  })
})

test("blocked permission flow supports reject", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock permission reject", async (session) => {
    await gotoSession(session.id)
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
        await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(1)
        await expect(page.locator(promptSelector)).toHaveCount(0)

        await clearPermissionDock(page, /deny/i)
        await page.goto(page.url())
        await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(0)
        await expect(page.locator(promptSelector)).toBeVisible()
      },
    )
  })
})

test("blocked permission flow supports allow always", async ({ page, sdk, gotoSession }) => {
  await withDockSession(sdk, "e2e composer dock permission always", async (session) => {
    await gotoSession(session.id)
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
        await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(1)
        await expect(page.locator(promptSelector)).toHaveCount(0)

        await clearPermissionDock(page, /allow always/i)
        await page.goto(page.url())
        await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(0)
        await expect(page.locator(promptSelector)).toBeVisible()
      },
    )
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
    await setAutoAccept(page, false)

    const child = await sdk.session
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
        { child },
        async () => {
          await page.goto(page.url())
          const dock = page.locator(permissionDockSelector)
          await expect.poll(() => dock.count(), { timeout: 10_000 }).toBe(1)
          await expect(page.locator(promptSelector)).toHaveCount(0)

          await clearPermissionDock(page, /allow once/i)
          await page.goto(page.url())

          await expect.poll(() => page.locator(permissionDockSelector).count(), { timeout: 10_000 }).toBe(0)
          await expect(page.locator(promptSelector)).toBeVisible()
        },
      )
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
