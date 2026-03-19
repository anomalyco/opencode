import type { Locator, Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { openSidebar, resolveSlug, sessionIDFromUrl, setWorkspacesEnabled, waitSessionIdle, waitSlug } from "../actions"
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
  model?: { providerID: string; modelID: string }
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const text = async (locator: Locator) => ((await locator.textContent()) ?? "").trim()

const modelKey = (state: Probe | null) => (state?.model ? `${state.model.providerID}:${state.model.modelID}` : null)

const dirKey = (state: Probe | null) => state?.dir ?? ""

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

async function currentDir(page: Page) {
  let hit = ""
  await expect
    .poll(
      async () => {
        const next = dirKey(await probe(page))
        if (next) hit = next
        return next
      },
      { timeout: 30_000 },
    )
    .not.toBe("")
  return hit
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
  await select.locator('[data-action], [data-slot="select-select-trigger"]').first().click()
  const item = page
    .locator('[data-slot="select-select-item"]')
    .filter({ hasText: new RegExp(`^\\s*${escape(value)}\\s*$`) })
    .first()
  await expect(item).toBeVisible()
  await item.click()
}

async function variantCount(page: Page) {
  const select = page.locator(promptVariantSelector)
  await expect(select).toBeVisible()
  await select.locator('[data-slot="select-select-trigger"]').click()
  const count = await page.locator('[data-slot="select-select-item"]').count()
  await page.keyboard.press("Escape")
  return count
}

async function agents(page: Page) {
  const select = page.locator(promptAgentSelector)
  await expect(select).toBeVisible()
  await select.locator('[data-action], [data-slot="select-select-trigger"]').first().click()
  const labels = await page.locator('[data-slot="select-select-item-label"]').allTextContents()
  await page.keyboard.press("Escape")
  return labels.map((item) => item.trim()).filter(Boolean)
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
  const select = page.locator(promptVariantSelector)
  await expect(select).toBeVisible()
  await select.locator('[data-slot="select-select-trigger"]').click()

  const items = page.locator('[data-slot="select-select-item"]')
  const count = await items.count()
  if (count < 2) throw new Error("Current model has no alternate variant to select")

  for (let i = 0; i < count; i++) {
    const item = items.nth(i)
    const next = await text(item.locator('[data-slot="select-select-item-label"]').first())
    if (!next || next === current.variant) continue
    await item.click()
    return waitFooter(page, { agent: current.agent, model: current.model, variant: next })
  }

  throw new Error("Failed to choose a different variant")
}

async function chooseOtherModel(page: Page): Promise<Footer> {
  const current = await read(page)
  const button = page.locator(`${promptModelSelector} [data-action="prompt-model"]`)
  await expect(button).toBeVisible()
  await button.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  const items = dialog.locator('[data-slot="list-item"]')
  const count = await items.count()
  expect(count).toBeGreaterThan(1)

  for (let i = 0; i < count; i++) {
    const item = items.nth(i)
    const selected = (await item.getAttribute("data-selected")) === "true"
    if (selected) continue
    await item.click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => (await read(page)).model !== current.model, { timeout: 30_000 }).toBe(true)
    return read(page)
  }

  throw new Error("Failed to choose a different model")
}

async function goto(page: Page, directory: string, sessionID?: string) {
  await page.goto(sessionPath(directory, sessionID))
  await expect(page.locator(promptSelector)).toBeVisible()
  await expect.poll(async () => dirKey(await probe(page)), { timeout: 30_000 }).toBe(directory)
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
  await expect(page).toHaveURL(new RegExp(`/${next.slug}/session(?:[/?#]|$)`))
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
  await expect(page).toHaveURL(new RegExp(`/${next.slug}/session(?:[/?#]|$)`))
  await expect(page.locator(promptSelector)).toBeVisible()
  return currentDir(page)
}

test("session model and variant restore per session without leaking into new sessions", async ({
  page,
  withProject,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await withProject(async ({ directory, gotoSession, trackSession }) => {
    await gotoSession()

    await ensureVariant(page, directory)
    const firstState = await chooseDifferentVariant(page)
    const first = await submit(page, `session variant ${Date.now()}`)
    trackSession(first)
    await waitUser(directory, first)

    await page.reload()
    await expect(page.locator(promptSelector)).toBeVisible()
    await waitFooter(page, firstState)

    await gotoSession()
    const fresh = await ensureVariant(page, directory)
    expect(fresh.variant).not.toBe(firstState.variant)

    const secondState = await chooseOtherModel(page)
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

    await ensureVariant(page, root)
    const firstState = await chooseDifferentVariant(page)
    const first = await submit(page, `root session ${Date.now()}`)
    trackSession(first, root)
    await waitUser(root, first)

    await openSidebar(page)
    await setWorkspacesEnabled(page, slug, true)

    const one = await createWorkspace(page, slug, [])
    const oneDir = await newWorkspaceSession(page, one.slug)
    trackDirectory(oneDir)

    const secondState = await chooseOtherModel(page)
    const second = await submit(page, `workspace one ${Date.now()}`)
    trackSession(second, oneDir)
    await waitUser(oneDir, second)

    const two = await createWorkspace(page, slug, [one.slug])
    const twoDir = await newWorkspaceSession(page, two.slug)
    trackDirectory(twoDir)

    await ensureVariant(page, twoDir)
    const thirdState = await chooseDifferentVariant(page)
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
