import type { Locator, Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { promptAgentSelector, promptModelSelector, promptSelector } from "../selectors"

type Probe = {
  agent?: string
  model?: { providerID: string; modelID: string; name?: string }
  models?: Array<{ providerID: string; modelID: string; name: string }>
  agents?: Array<{ name: string }>
}

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

async function state(page: Page) {
  const value = await probe(page)
  if (!value) throw new Error("Failed to resolve model selection probe")
  return value
}

async function ready(page: Page) {
  const prompt = page.locator(promptSelector)
  await prompt.click()
  await expect(prompt).toBeFocused()
  await prompt.pressSequentially("focus")
  return prompt
}

async function body(prompt: Locator) {
  return prompt.evaluate((el) => (el as HTMLElement).innerText)
}

test("agent select returns focus to the prompt", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = await ready(page)

  const info = await state(page)
  const next = info.agents?.map((item) => item.name).find((name) => name !== info.agent)
  test.skip(!next, "only one agent available")
  if (!next) return

  await page.locator(`${promptAgentSelector} [data-slot="select-select-trigger"]`).first().click()

  const item = page.locator('[data-slot="select-select-item"]').filter({ hasText: next }).first()
  await expect(item).toBeVisible()
  await item.click({ force: true })

  await expect(page.locator(`${promptAgentSelector} [data-slot="select-select-trigger-value"]`).first()).toHaveText(
    next,
  )
  await expect(prompt).toBeFocused()
  await prompt.pressSequentially(" agent")
  await expect.poll(() => body(prompt)).toContain("focus agent")
})

test("model select returns focus to the prompt", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = await ready(page)

  const info = await state(page)
  const key = info.model ? `${info.model.providerID}:${info.model.modelID}` : null
  const next = info.models?.find((item) => `${item.providerID}:${item.modelID}` !== key)
  test.skip(!next, "only one model available")
  if (!next) return

  await page.locator(`${promptModelSelector} [data-action="prompt-model"]`).first().click()

  const item = page.locator(`[data-slot="list-item"][data-key="${next.providerID}:${next.modelID}"]`).first()
  await expect(item).toBeVisible()
  await item.click({ force: true })

  await expect(page.locator(`${promptModelSelector} [data-action="prompt-model"] span`).first()).toHaveText(next.name)
  await expect(prompt).toBeFocused()
  await prompt.pressSequentially(" model")
  await expect.poll(() => body(prompt)).toContain("focus model")
})
