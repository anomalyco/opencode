import type { Locator, Page } from "@playwright/test"
import * as fs from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { test, expect } from "../fixtures"
import { withSession } from "../actions"
import {
  messageAnnotationBasketSelector,
  messageAnnotationCardSelector,
  messageAnnotationCommentSelector,
  messageAnnotationHeadSelector,
  messageAnnotationInputSelector,
  messageAnnotationPopoverSelector,
  messageAnnotationRemoveSelector,
  messageAnnotationSaveSelector,
  messageAnnotationTriggerOpenSelector,
  messageAnnotationTriggerSelector,
  promptSelector,
  promptSubmitSelector,
  sessionMessageSelectionSelector,
} from "../selectors"
import { modKey } from "../utils"

type Assistant = Parameters<typeof test>[0]["assistant"]
type Sdk = Parameters<typeof withSession>[0]
type Pick = Parameters<typeof select>[1]
type Variant = "icon" | "toolbar" | "mini"

const dir = fileURLToPath(new URL("../../../../.sisyphus/evidence/", import.meta.url))
const file = (name: string) => fileURLToPath(new URL(`../../../../.sisyphus/evidence/${name}`, import.meta.url))

const body = (parts: Array<{ type: string; text?: string }>) =>
  parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")

const promptText = async (page: Page) =>
  page.locator(promptSelector).evaluate((el) => (el.textContent ?? "").replace(/\u200B/g, "").trim())

const selText = async (page: Page) =>
  page.evaluate(() => (window.getSelection()?.toString() ?? "").replace(/\u200B/g, ""))

async function armCopy(page: Page) {
  await page.evaluate(() => {
    const win = window as Window & { __task7?: { copy?: string | null } }
    const state = win.__task7 ?? (win.__task7 = {})
    state.copy = null
    document.addEventListener(
      "copy",
      (event) => {
        state.copy = event.clipboardData?.getData("text/plain") || window.getSelection()?.toString() || ""
      },
      { once: true, capture: true },
    )
  })
}

const copied = (page: Page) =>
  page.evaluate(() => {
    const win = window as Window & { __task7?: { copy?: string | null } }
    return win.__task7?.copy ?? null
  })

async function clear(page: Page) {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }))
  })
}

async function setVariant(page: Page, variant: Variant) {
  await page.evaluate((variant) => {
    const win = window as Window & {
      __opencode_e2e?: {
        messageAnnotation?: {
          enabled?: boolean
          variant?: string
        }
      }
    }
    win.__opencode_e2e = {
      ...win.__opencode_e2e,
      messageAnnotation: {
        ...win.__opencode_e2e?.messageAnnotation,
        enabled: true,
        variant,
      },
    }
  }, variant)
}

const point = (loc: Locator) => loc.evaluate((el) => ({ left: el.style.left, top: el.style.top }))

const select = async (
  page: Page,
  input: {
    startSel: string
    startText: string
    endSel?: string
    endText?: string
  },
) =>
  page.evaluate((input) => {
    const find = (sel: string, text: string, edge: "start" | "end") => {
      const root = document.querySelector(sel)
      if (!(root instanceof Element)) throw new Error(`Missing selection root: ${sel}`)

      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walk.nextNode()) {
        const node = walk.currentNode
        const value = node.textContent ?? ""
        const index = edge === "start" ? value.indexOf(text) : value.lastIndexOf(text)
        if (index === -1) continue
        return {
          node,
          offset: edge === "start" ? index : index + text.length,
          root,
        }
      }

      throw new Error(`Missing selection text: ${text}`)
    }

    const start = find(input.startSel, input.startText, "start")
    const end = find(input.endSel ?? input.startSel, input.endText ?? input.startText, "end")
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)

    const sel = window.getSelection()
    if (!sel) throw new Error("Missing window selection")
    sel.removeAllRanges()
    sel.addRange(range)
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }))
    end.root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  }, input)

async function list(sdk: Sdk, sessionID: string) {
  return sdk.session.messages({ sessionID, limit: 100 }).then((r) => r.data ?? [])
}

async function showTrigger(input: {
  page: Page
  pick: Pick
  text: string
  trg: Locator
  pop: Locator
}) {
  await expect(
    async () => {
      await select(input.page, input.pick)
      await expect(input.trg).toBeVisible()
      await expect(input.pop).toHaveCount(0)
      await expect.poll(() => selText(input.page), { timeout: 3_000 }).toBe(input.text)
    },
    { message: `Expected annotation trigger for ${input.text}` },
  ).toPass({ timeout: 30_000, intervals: [250, 500, 1_000] })
}

async function openEditor(input: {
  page: Page
  pick: Pick
  btn: Locator
  trg: Locator
  pop: Locator
  head: Locator
  note: Locator
  save: Locator
  text: string
}) {
  if ((await input.btn.count()) === 0) {
    await showTrigger({ page: input.page, pick: input.pick, text: input.text, trg: input.trg, pop: input.pop })
  }

  await expect(input.btn).toBeVisible()
  await expect(input.pop).toHaveCount(0)
  await input.btn.click()
  await expect(input.pop).toBeVisible()
  await expect(input.trg).toHaveCount(0)
  await expect(input.head).toHaveText(input.text)
  await expect
    .poll(
      () =>
        input.pop
          .evaluate((el) => ({ opacity: el.style.opacity, pointer: el.style.pointerEvents }))
          .catch(() => ({ opacity: "", pointer: "" })),
      { timeout: 3_000 },
    )
    .toEqual({ opacity: "1", pointer: "auto" })
  await expect(input.note).toBeVisible()
  await expect(input.note).toBeEditable()
  await expect(input.note).toBeFocused()
  await expect(input.save).toBeDisabled()
}

async function reject(input: {
  page: Page
  pick: Pick
  trg: Locator
  pop: Locator
  basket: Locator
  count: number
  start?: Locator
  end?: Locator
}) {
  await expect(
    async () => {
      if (input.start) {
        await input.start.scrollIntoViewIfNeeded()
        await expect(input.start).toBeVisible()
      }

      if (input.end) {
        await input.end.scrollIntoViewIfNeeded()
        await expect(input.end).toBeVisible()
      }

      await select(input.page, input.pick)
      await expect(input.trg).toHaveCount(0)
      await expect(input.pop).toHaveCount(0)
      await expect(input.basket).toHaveCount(input.count)
    },
    { message: "Expected invalid selection to stay rejected" },
  ).toPass({ timeout: 30_000, intervals: [250, 500, 1_000] })
}

async function shot(input: {
  page: Page
  variant: Variant
  pick: Pick
  text: string
  trg: Locator
  btn: Locator
  pop: Locator
}) {
  await expect(
    async () => {
      await setVariant(input.page, input.variant)
      await showTrigger({ page: input.page, pick: input.pick, text: input.text, trg: input.trg, pop: input.pop })
      await expect(input.btn).toHaveAttribute("data-variant", input.variant)
      await expect(input.btn).toBeVisible()

      const box = await input.btn.boundingBox()
      if (!box || box.width <= 0 || box.height <= 0) {
        throw new Error(`Expected visible trigger box for ${input.variant}`)
      }

      const size = await input.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
      const x = Math.max(0, Math.floor(box.x) - 2)
      const y = Math.max(0, Math.floor(box.y) - 2)
      const clip = {
        x,
        y,
        width: Math.min(Math.ceil(box.width) + 4, size.width - x),
        height: Math.min(Math.ceil(box.height) + 4, size.height - y),
      }

      if (clip.width <= 0 || clip.height <= 0) {
        throw new Error(`Expected positive screenshot clip for ${input.variant}`)
      }

      await input.page.screenshot({ path: file(`task-7-message-annotation-${input.variant}.png`), clip })
    },
    { message: `Expected visible ${input.variant} annotation trigger for screenshot capture` },
  ).toPass({ timeout: 30_000, intervals: [250, 500, 1_000] })

  await clear(input.page)
  await expect(input.trg).toHaveCount(0)
}

async function seed(input: {
  assistant: Assistant
  sdk: Sdk
  sessionID: string
  prompt: string
  reply: string
}) {
  await input.assistant.reply(input.reply)
  await input.sdk.session.prompt({
    sessionID: input.sessionID,
    parts: [{ type: "text", text: input.prompt }],
  })

  let id: string | undefined
  await expect
    .poll(
      async () => {
        const items = await list(input.sdk, input.sessionID)
        const users = items.filter(
          (item) => item.info.role === "user" && body(item.parts).includes(input.prompt),
        )
        const assistant = items.find(
          (item) => item.info.role === "assistant" && body(item.parts).includes(input.reply),
        )
        if (users.length === 0 || !assistant) return false
        id = assistant.info.id
        return true
      },
      { timeout: 120_000, intervals: [250, 500, 1_000] },
    )
    .toBe(true)

  if (!id) throw new Error("Expected an assistant message id")

  return { id, reply: input.reply }
}

test.setTimeout(180_000)

test("message annotations require an explicit trigger click, preserve copy, export comments, and reject invalid selection", async ({
  assistant,
  page,
  project,
}) => {
  const stamp = Date.now()
  const a = `Alpha sentence ${stamp}.`
  const b = `Beta sentence ${stamp}.`
  const c = `Cross sentence ${stamp}.`
  const s = `Space lead ${stamp}   Space tail ${stamp}`
  const keep = `Keep alpha ${stamp}`
  const remove = `Remove beta ${stamp}`
  const draft = `Follow up ${stamp}`
  const firstPrompt = `Seed first annotation ${stamp}`
  const secondPrompt = `Seed second annotation ${stamp}`
  const thirdPrompt = `Seed whitespace annotation ${stamp}`
  const title = `e2e message annotations ${stamp}`

  await project.open()

  await withSession(project.sdk, title, async (session) => {
    project.trackSession(session.id)
    const sdk = project.sdk

    const one = await seed({
      assistant,
      sdk,
      sessionID: session.id,
      prompt: firstPrompt,
      reply: `${a}\n\n${b}`,
    })
    const two = await seed({
      assistant,
      sdk,
      sessionID: session.id,
      prompt: secondPrompt,
      reply: c,
    })
    const three = await seed({
      assistant,
      sdk,
      sessionID: session.id,
      prompt: thirdPrompt,
      reply: s,
    })

    await project.gotoSession(session.id)

    const before = await list(sdk, session.id)
    const users = before.filter((item) => item.info.role === "user").length
    const oneSel = sessionMessageSelectionSelector({ id: one.id, role: "assistant" })
    const twoSel = sessionMessageSelectionSelector({ id: two.id, role: "assistant" })
    const threeSel = sessionMessageSelectionSelector({ id: three.id, role: "assistant" })
    const trg = page.locator(messageAnnotationTriggerSelector)
    const btn = page.locator(messageAnnotationTriggerOpenSelector)
    const pop = page.locator(messageAnnotationPopoverSelector)
    const head = page.locator(messageAnnotationHeadSelector)
    const promptSubmit = page.locator(promptSubmitSelector)
    const note = page.locator(messageAnnotationInputSelector)
    const save = page.locator(messageAnnotationSaveSelector)
    const alpha = page.getByText(a, { exact: true }).last()
    const cross = page.getByText(c, { exact: true }).last()
    const basket = page.locator(messageAnnotationBasketSelector)

    await expect(page.locator(oneSel).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.locator(threeSel).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.locator(promptSelector)).toBeVisible()

    await showTrigger({
      page,
      pick: { startSel: oneSel, startText: a },
      text: a,
      trg,
      pop,
    })
    await expect(btn).toHaveAttribute("data-variant", "icon")
    await armCopy(page)
    await page.keyboard.press(`${modKey}+C`)
    await expect.poll(() => copied(page), { timeout: 5_000 }).toBe(a)
    await expect.poll(() => selText(page), { timeout: 5_000 }).toBe(a)

    const first = await point(trg)
    await openEditor({ page, pick: { startSel: oneSel, startText: a }, btn, trg, pop, head, note, save, text: a })
    await note.fill("draft")

    await showTrigger({
      page,
      pick: { startSel: oneSel, startText: b },
      text: b,
      trg,
      pop,
    })
    await expect(note).toHaveCount(0)
    expect(await point(trg)).not.toEqual(first)

    await openEditor({ page, pick: { startSel: oneSel, startText: b }, btn, trg, pop, head, note, save, text: b })
    await expect(note).toHaveValue("")

    await note.fill(keep)
    await save.click()

    await expect(pop).toHaveCount(0)
    await expect(basket).toBeVisible()
    await expect(page.locator(messageAnnotationCardSelector)).toHaveCount(1)
    await expect(promptSubmit).toHaveAttribute("aria-label", "Add comment to prompt")

    const notes = page.locator(messageAnnotationCommentSelector)
    await notes.first().fill(`${keep} edited`)
    await expect(notes.first()).toHaveValue(`${keep} edited`)

    await showTrigger({
      page,
      pick: { startSel: oneSel, startText: a },
      text: a,
      trg,
      pop,
    })

    await openEditor({ page, pick: { startSel: oneSel, startText: a }, btn, trg, pop, head, note, save, text: a })
    await note.fill(remove)
    await save.click()

    await expect(page.locator(messageAnnotationCardSelector)).toHaveCount(2)
    await expect(promptSubmit).toHaveAttribute("aria-label", "Add comments to prompt")
    await page.locator(messageAnnotationRemoveSelector).nth(1).click()
    await expect(page.locator(messageAnnotationCardSelector)).toHaveCount(1)
    await expect(page.locator(messageAnnotationCommentSelector).first()).toHaveValue(`${keep} edited`)
    await expect(promptSubmit).toHaveAttribute("aria-label", "Add comment to prompt")

    await page.locator(promptSelector).click()
    await page.keyboard.type(draft)
    await promptSubmit.click()

    await expect.poll(() => promptText(page), { timeout: 30_000 }).toContain(draft)
    await expect.poll(() => promptText(page), { timeout: 30_000 }).toContain("# Conversation Feedback")
    await expect.poll(() => promptText(page), { timeout: 30_000 }).toContain(b)
    await expect.poll(() => promptText(page), { timeout: 30_000 }).toContain(`${keep} edited`)
    await expect(basket).toHaveCount(0)
    await expect(promptSubmit).toHaveAttribute("aria-label", "Send")
    await expect
      .poll(async () => (await list(sdk, session.id)).filter((item) => item.info.role === "user").length, {
        timeout: 30_000,
      })
      .toBe(users)

    await promptSubmit.click()

    await expect
      .poll(
        async () => {
          const items = await list(sdk, session.id)
          const count = items.filter((item) => item.info.role === "user").length
          return (
            count === users + 1 &&
            items.some(
              (item) =>
                item.info.role === "user" &&
                body(item.parts).includes(draft) &&
                body(item.parts).includes("# Conversation Feedback") &&
                body(item.parts).includes(b) &&
                body(item.parts).includes(`${keep} edited`) &&
                !body(item.parts).includes(remove),
            )
          )
        },
        { timeout: 90_000, intervals: [250, 500, 1_000] },
      )
      .toBe(true)

    await reject({
      page,
      start: alpha,
      end: cross,
      pick: { startSel: oneSel, startText: a, endSel: twoSel, endText: c },
      trg,
      pop,
      basket,
      count: 0,
    })
    await reject({
      page,
      pick: { startSel: threeSel, startText: "   " },
      trg,
      pop,
      basket,
      count: 0,
    })
  })
})

test("message annotation trigger variants save deterministic preview artifacts", async ({ assistant, page, project }) => {
  const stamp = Date.now()
  const quote = `Variant preview ${stamp} with enough detail to keep the trigger screenshots deterministic across icon toolbar and mini.`
  const prompt = `Seed variant preview ${stamp}`
  const title = `e2e message annotation previews ${stamp}`

  await fs.mkdir(dir, { recursive: true })
  await project.open()

  await withSession(project.sdk, title, async (session) => {
    project.trackSession(session.id)
    const sdk = project.sdk
    const item = await seed({
      assistant,
      sdk,
      sessionID: session.id,
      prompt,
      reply: quote,
    })

    await project.gotoSession(session.id)

    const sel = sessionMessageSelectionSelector({ id: item.id, role: "assistant" })
    const trg = page.locator(messageAnnotationTriggerSelector)
    const btn = page.locator(messageAnnotationTriggerOpenSelector)
    const pop = page.locator(messageAnnotationPopoverSelector)

    await expect(page.locator(sel).first()).toBeVisible({ timeout: 60_000 })

    for (const variant of ["icon", "toolbar", "mini"] as const) {
      await shot({
        page,
        variant,
        pick: { startSel: sel, startText: quote },
        text: quote,
        trg,
        btn,
        pop,
      })
    }
  })
})
