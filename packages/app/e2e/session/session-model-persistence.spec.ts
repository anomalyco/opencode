import type { Locator, Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import {
  openSidebar,
  resolveSlug,
  sessionIDFromUrl,
  setWorkspacesEnabled,
  waitSession,
  waitSessionIdle,
  waitSlug,
} from "../actions"
import {
  promptAgentSelector,
  promptModelSelector,
  promptSelector,
  promptVariantSelector,
  workspaceItemSelector,
  workspaceNewSessionSelector,
} from "../selectors"
import { createSdk, sessionPath } from "../utils"

type Footer = {
  agent: string
  model: string
  variant: string
}

type Probe = {
  dir?: string
  sessionID?: string
  agent?: string
  model?: { providerID: string; modelID: string; name?: string }
  variant?: string | null
  pick?: {
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string | null
  }
  variants?: string[]
  models?: Array<{ providerID: string; modelID: string; name: string }>
  agents?: Array<{ name: string }>
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const text = async (locator: Locator) => ((await locator.textContent()) ?? "").trim()

const modelKey = (state: Probe | null) => (state?.model ? `${state.model.providerID}:${state.model.modelID}` : null)

async function probe(page: Page): Promise<Probe | null> {
  return page.evaluate(() => {
    const win = window as Window & {
      __opencode_e2e?: {
        model?: {
          current?: Probe
        }
      }
    }
    return win.__opencode_e2e?.model?.current ?? null
  })
}

async function currentModel(page: Page) {
  await expect.poll(() => probe(page).then(modelKey), { timeout: 30_000 }).not.toBe(null)
  const value = await probe(page).then(modelKey)
  if (!value) throw new Error("Failed to resolve current model key")
  return value
}

async function waitControl(page: Page, key: "setAgent" | "setModel" | "setVariant") {
  await expect
    .poll(
      () =>
        page.evaluate((key) => {
          const win = window as Window & {
            __opencode_e2e?: {
              model?: {
                controls?: Record<string, unknown>
              }
            }
          }
          return !!win.__opencode_e2e?.model?.controls?.[key]
        }, key),
      { timeout: 30_000 },
    )
    .toBe(true)
}

async function pickAgent(page: Page, value: string) {
  await waitControl(page, "setAgent")
  await page.evaluate((value) => {
    const win = window as Window & {
      __opencode_e2e?: {
        model?: {
          controls?: {
            setAgent?: (value: string | undefined) => void
          }
        }
      }
    }
    const fn = win.__opencode_e2e?.model?.controls?.setAgent
    if (!fn) throw new Error("Model e2e agent control is not enabled")
    fn(value)
  }, value)
}

async function pickModel(page: Page, value: { providerID: string; modelID: string }) {
  await waitControl(page, "setModel")
  await page.evaluate((value) => {
    const win = window as Window & {
      __opencode_e2e?: {
        model?: {
          controls?: {
            setModel?: (value: { providerID: string; modelID: string } | undefined) => void
          }
        }
      }
    }
    const fn = win.__opencode_e2e?.model?.controls?.setModel
    if (!fn) throw new Error("Model e2e model control is not enabled")
    fn(value)
  }, value)
}

async function pickVariant(page: Page, value: string) {
  await waitControl(page, "setVariant")
  await page.evaluate((value) => {
    const win = window as Window & {
      __opencode_e2e?: {
        model?: {
          controls?: {
            setVariant?: (value: string | undefined) => void
          }
        }
      }
    }
    const fn = win.__opencode_e2e?.model?.controls?.setVariant
    if (!fn) throw new Error("Model e2e variant control is not enabled")
    fn(value)
  }, value)
}

async function read(page: Page): Promise<Footer> {
  return {
    agent: await text(page.locator(`${promptAgentSelector} [data-slot="select-select-trigger-value"]`).first()),
    model: await text(page.locator(`${promptModelSelector} [data-action="prompt-model"] span`).first()),
    variant: await text(page.locator(`${promptVariantSelector} [data-slot="select-select-trigger-value"]`).first()),
  }
}

async function waitFooter(page: Page, expected: Partial<Footer>) {
  let hit: Footer | null = null
  await expect
    .poll(
      async () => {
        const state = await read(page)
        const ok = Object.entries(expected).every(([key, value]) => state[key as keyof Footer] === value)
        if (ok) hit = state
        return ok
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  if (!hit) throw new Error("Failed to resolve prompt footer state")
  return hit
}

async function waitModel(page: Page, value: string) {
  await expect.poll(() => probe(page).then(modelKey), { timeout: 30_000 }).toBe(value)
}

async function choose(page: Page, root: string, value: string) {
  const select = page.locator(root)
  await expect(select).toBeVisible()
  await pickAgent(page, value)
}

async function variantCount(page: Page) {
  return (await probe(page))?.variants?.length ?? 0
}

async function agents(page: Page) {
  return ((await probe(page))?.agents ?? []).map((item) => item.name).filter(Boolean)
}

async function ensureVariant(page: Page, directory: string): Promise<Footer> {
  const current = await read(page)
  if ((await variantCount(page)) >= 2) return current

  const cfg = await createSdk(directory)
    .config.get()
    .then((x) => x.data)
  const visible = new Set(await agents(page))
  const entry = Object.entries(cfg?.agent ?? {}).find((item) => {
    const value = item[1]
    return !!value && typeof value === "object" && "variant" in value && "model" in value && visible.has(item[0])
  })
  const name = entry?.[0]
  test.skip(!name, "no agent with alternate variants available")
  if (!name) return current

  await choose(page, promptAgentSelector, name)
  await expect.poll(() => variantCount(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
  return waitFooter(page, { agent: name })
}

async function chooseDifferentVariant(page: Page): Promise<Footer> {
  const current = await read(page)
  const next = (await probe(page))?.variants?.find((item) => item !== current.variant)
  if (!next) throw new Error("Current model has no alternate variant to select")

  await pickVariant(page, next)
  return waitFooter(page, { agent: current.agent, model: current.model, variant: next })
}

async function chooseOtherModel(page: Page, skip: string[] = []): Promise<Footer> {
  const current = await currentModel(page)
  const next = (await probe(page))?.models?.find((item) => {
    const key = `${item.providerID}:${item.modelID}`
    return key !== current && !skip.includes(key)
  })
  if (!next) throw new Error("Failed to choose a different model")
  await pickModel(page, { providerID: next.providerID, modelID: next.modelID })
  await expect.poll(async () => (await read(page)).model, { timeout: 30_000 }).toBe(next.name)
  return read(page)
}

async function goto(page: Page, directory: string, sessionID?: string) {
  await page.goto(sessionPath(directory, sessionID))
  await waitSession(page, { directory, sessionID })
}

async function submit(page: Page, value: string) {
  const prompt = page.locator(promptSelector)
  await expect(prompt).toBeVisible()
  await prompt.click()
  await prompt.fill(value)
  await prompt.press("Enter")

  await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 30_000 }).not.toBe("")
  const id = sessionIDFromUrl(page.url())
  if (!id) throw new Error(`Failed to resolve session id from ${page.url()}`)
  return id
}

async function waitUser(directory: string, sessionID: string) {
  const sdk = createSdk(directory)
  await expect
    .poll(
      async () => {
        const items = await sdk.session.messages({ sessionID, limit: 20 }).then((x) => x.data ?? [])
        return items.some((item) => item.info.role === "user")
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  await sdk.session.abort({ sessionID }).catch(() => undefined)
  await waitSessionIdle(sdk, sessionID, 30_000).catch(() => undefined)
}

async function createWorkspace(page: Page, root: string, seen: string[]) {
  await openSidebar(page)
  await page.getByRole("button", { name: "New workspace" }).first().click()

  const next = await resolveSlug(await waitSlug(page, [root, ...seen]))
  await waitSession(page, { directory: next.directory })
  return next
}

async function waitWorkspace(page: Page, slug: string) {
  await openSidebar(page)
  await expect
    .poll(
      async () => {
        const item = page.locator(workspaceItemSelector(slug)).first()
        try {
          await item.hover({ timeout: 500 })
          return true
        } catch {
          return false
        }
      },
      { timeout: 60_000 },
    )
    .toBe(true)
}

async function newWorkspaceSession(page: Page, slug: string) {
  await waitWorkspace(page, slug)
  const item = page.locator(workspaceItemSelector(slug)).first()
  await item.hover()

  const button = page.locator(workspaceNewSessionSelector(slug)).first()
  await expect(button).toBeVisible()
  await button.click({ force: true })

  const next = await resolveSlug(await waitSlug(page))
  return waitSession(page, { directory: next.directory }).then((item) => item.directory)
}

test("session model restore per session without leaking into new sessions", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await withProject(async ({ directory, gotoSession, trackSession }) => {
    await gotoSession()

    const firstState = await chooseOtherModel(page)
    const firstKey = await currentModel(page)
    const first = await submit(page, `session variant ${Date.now()}`)
    trackSession(first)
    await waitUser(directory, first)

    await page.reload()
    await waitSession(page, { directory, sessionID: first })
    await waitFooter(page, firstState)

    await gotoSession()
    const fresh = await read(page)
    expect(fresh.model).not.toBe(firstState.model)

    const secondState = await chooseOtherModel(page, [firstKey])
    const second = await submit(page, `session model ${Date.now()}`)
    trackSession(second)
    await waitUser(directory, second)

    await goto(page, directory, first)
    await waitFooter(page, firstState)

    await goto(page, directory, second)
    await waitFooter(page, secondState)

    await gotoSession()
    await waitFooter(page, fresh)
  })
})

test("session model restore across workspaces", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await withProject(async ({ directory: root, slug, gotoSession, trackDirectory, trackSession }) => {
    await gotoSession()

    const firstState = await chooseOtherModel(page)
    const firstKey = await currentModel(page)
    const first = await submit(page, `root session ${Date.now()}`)
    trackSession(first, root)
    await waitUser(root, first)

    await openSidebar(page)
    await setWorkspacesEnabled(page, slug, true)

    const one = await createWorkspace(page, slug, [])
    const oneDir = await newWorkspaceSession(page, one.slug)
    trackDirectory(oneDir)

    const secondState = await chooseOtherModel(page, [firstKey])
    const secondKey = await currentModel(page)
    const second = await submit(page, `workspace one ${Date.now()}`)
    trackSession(second, oneDir)
    await waitUser(oneDir, second)

    const two = await createWorkspace(page, slug, [one.slug])
    const twoDir = await newWorkspaceSession(page, two.slug)
    trackDirectory(twoDir)

    const thirdState = await chooseOtherModel(page, [firstKey, secondKey])
    const third = await submit(page, `workspace two ${Date.now()}`)
    trackSession(third, twoDir)
    await waitUser(twoDir, third)

    await goto(page, root, first)
    await waitFooter(page, firstState)

    await goto(page, oneDir, second)
    await waitFooter(page, secondState)

    await goto(page, twoDir, third)
    await waitFooter(page, thirdState)

    await goto(page, root, first)
    await waitFooter(page, firstState)
  })
})

test("variant preserved when switching agent modes", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await withProject(async ({ directory, gotoSession }) => {
    await gotoSession()

    await ensureVariant(page, directory)
    const updated = await chooseDifferentVariant(page)

    const available = await agents(page)
    const other = available.find((name) => name !== updated.agent)
    test.skip(!other, "only one agent available")
    if (!other) return

    await choose(page, promptAgentSelector, other)
    await waitFooter(page, { agent: other, variant: updated.variant })

    await choose(page, promptAgentSelector, updated.agent)
    await waitFooter(page, { agent: updated.agent, variant: updated.variant })
  })
})
