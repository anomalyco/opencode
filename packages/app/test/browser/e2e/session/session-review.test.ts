import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { defocus, waitSessionIdle, withSession } from "../../../../e2e/actions"
import { createSdk, modKey, serverUrl } from "../../../../e2e/utils"
import { openProjectSession } from "../../support/use-app-browser"

const count = 14

function body(mark: string) {
  return [
    `title ${mark}`,
    `mark ${mark}`,
    ...Array.from({ length: 32 }, (_, i) => `line ${String(i + 1).padStart(2, "0")} ${mark}`),
  ]
}

function files(tag: string) {
  return Array.from({ length: count }, (_, i) => {
    const id = String(i).padStart(2, "0")
    return {
      file: `review-scroll-${id}.txt`,
      mark: `${tag}-${id}`,
    }
  })
}

function seed(list: ReturnType<typeof files>) {
  const out = ["*** Begin Patch"]

  for (const item of list) {
    out.push(`*** Add File: ${item.file}`)
    for (const line of body(item.mark)) out.push(`+${line}`)
  }

  out.push("*** End Patch")
  return out.join("\n")
}

function edit(file: string, prev: string, next: string) {
  return ["*** Begin Patch", `*** Update File: ${file}`, "@@", `-mark ${prev}`, `+mark ${next}`, "*** End Patch"].join("\n")
}

async function patch(sdk: ReturnType<typeof createSdk>, sessionID: string, patchText: string) {
  await sdk.session.promptAsync({
    sessionID,
    agent: "build",
    system: [
      "You are seeding deterministic e2e UI state.",
      "Your only valid response is one apply_patch tool call.",
      `Use this JSON input: ${JSON.stringify({ patchText })}`,
      "Do not call any other tools.",
      "Do not output plain text.",
    ].join("\n"),
    parts: [{ type: "text", text: "Apply the provided patch exactly once." }],
  })

  await waitSessionIdle(sdk, sessionID, 120_000)
}

async function waitMark(page: import("playwright").Page, file: string, mark: string) {
  await page.waitForFunction(
    ({ file: f, mark: m }) => {
      const view = document.querySelector('[data-slot="session-review-scroll"] .scroll-view__viewport')
      if (!(view instanceof HTMLElement)) return false

      const head = Array.from(view.querySelectorAll("h3")).find(
        (node) => node instanceof HTMLElement && node.textContent?.includes(f),
      )
      if (!(head instanceof HTMLElement)) return false

      return Array.from(head.parentElement?.querySelectorAll("diffs-container") ?? []).some((host) => {
        if (!(host instanceof HTMLElement)) return false
        const root = host.shadowRoot
        return root?.textContent?.includes(`mark ${m}`) ?? false
      })
    },
    { file, mark },
    { timeout: 60_000 },
  )
}

async function spot(page: import("playwright").Page, file: string) {
  return page.evaluate((f: string) => {
    const view = document.querySelector('[data-slot="session-review-scroll"] .scroll-view__viewport')
    if (!(view instanceof HTMLElement)) return null

    const row = Array.from(view.querySelectorAll("h3")).find(
      (node) => node instanceof HTMLElement && node.textContent?.includes(f),
    )
    if (!(row instanceof HTMLElement)) return null

    const a = row.getBoundingClientRect()
    const b = view.getBoundingClientRect()
    return {
      top: a.top - b.top,
      y: view.scrollTop,
    }
  }, file)
}

describe("session review scroll", () => {
  useE2eStack()
  const app = useAppBrowser()

  test.skipIf(Boolean(process.env.CI))(
    "review keeps scroll position after a live diff update",
    async () => {
      const page = app.page
      await page.setViewportSize({ width: 1600, height: 1000 })

      const tag = `review-${Date.now()}`
      const list = files(tag)
      const hit = list[list.length - 4]!
      const nextMark = `${tag}-live`

      const listSdk = createOpencodeClient({ baseUrl: serverUrl(), throwOnError: true })
      const created = await listSdk.project.create({ name: `e2e review ${tag}` })
      if (!created.data?.project?.id) throw new Error("project create failed")
      const pid = created.data.project.id
      const sdk = createSdk({ id: pid })

      await withSession(sdk, `e2e review ${tag}`, async (session) => {
        await patch(sdk, session.id, seed(list))

        await expect
          .poll(async () => {
            const info = await sdk.session.get({ sessionID: session.id }).then((res) => res.data)
            return info?.summary?.files ?? 0
          }, { timeout: 60_000 })
          .toBe(list.length)

        await expect
          .poll(async () => {
            const diff = await sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
            return diff.length
          }, { timeout: 60_000 })
          .toBe(list.length)

        await openProjectSession(page, app.origin, pid, session.id)

        await defocus(page)
        await page.keyboard.press(`${modKey}+Shift+R`)

        const tab = page.getByRole("tab", { name: /Review/i }).first()
        await tab.waitFor({ state: "visible" })
        await tab.click()

        const view = page.locator('[data-slot="session-review-scroll"] .scroll-view__viewport').first()
        await view.waitFor({ state: "visible" })
        const heads = page.getByRole("heading", { level: 3 }).filter({ hasText: /^review-scroll-/ })
        await expect.poll(async () => await heads.count(), { timeout: 60_000 }).toBe(list.length)

        const expandAll = page.getByRole("button", { name: /^Expand all$/i }).first()
        await expandAll.waitFor({ state: "visible" })
        await expandAll.click()
        await page.getByRole("button", { name: /^Collapse all$/i }).first().waitFor({ state: "visible" })

        await waitMark(page, hit.file, hit.mark)

        const row = page
          .getByRole("heading", { level: 3, name: new RegExp(hit.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
          .first()
        await row.waitFor({ state: "visible" })
        await row.evaluate((el) => el.scrollIntoView({ block: "center" }))

        await expect.poll(async () => (await spot(page, hit.file))?.y ?? 0).toBeGreaterThan(200)
        const prev = await spot(page, hit.file)
        if (!prev) throw new Error(`missing review row for ${hit.file}`)

        await patch(sdk, session.id, edit(hit.file, hit.mark, nextMark))

        await expect
          .poll(async () => {
            const diff = await sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
            const item = diff.find((item) => item.file === hit.file)
            return typeof item?.after === "string" ? item.after : ""
          }, { timeout: 60_000 })
          .toContain(`mark ${nextMark}`)

        await waitMark(page, hit.file, nextMark)

        await expect
          .poll(
            async () => {
              const nextSpot = await spot(page, hit.file)
              if (!nextSpot) return Number.POSITIVE_INFINITY
              return Math.max(Math.abs(nextSpot.top - prev.top), Math.abs(nextSpot.y - prev.y))
            },
            { timeout: 60_000 },
          )
          .toBeLessThanOrEqual(32)
      })
    },
    180_000,
  )
})
