import { waitSessionIdle, withSession } from "../actions"
import { test, expect } from "../fixtures"
import { createSdk } from "../utils"

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
  return ["*** Begin Patch", `*** Update File: ${file}`, "@@", `-mark ${prev}`, `+mark ${next}`, "*** End Patch"].join(
    "\n",
  )
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

async function show(page: Parameters<typeof test>[0]["page"]) {
  const btn = page.getByRole("button", { name: "Toggle review" }).first()
  await expect(btn).toBeVisible()
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click()
  await expect(btn).toHaveAttribute("aria-expanded", "true")
}

async function expand(page: Parameters<typeof test>[0]["page"]) {
  const close = page.getByRole("button", { name: /^Collapse all$/i }).first()
  const open = await close
    .isVisible()
    .then((value) => value)
    .catch(() => false)

  const btn = page.getByRole("button", { name: /^Expand all$/i }).first()
  if (open) {
    await close.click()
    await expect(btn).toBeVisible()
  }

  await expect(btn).toBeVisible()
  await btn.click()
  await expect(close).toBeVisible()
}

async function waitMark(page: Parameters<typeof test>[0]["page"], file: string, mark: string) {
  await page.waitForFunction(
    ({ file, mark }) => {
      const head = Array.from(document.querySelectorAll("h3")).find(
        (node) => node instanceof HTMLElement && node.textContent?.includes(file),
      )
      if (!(head instanceof HTMLElement)) return false

      return Array.from(head.parentElement?.querySelectorAll("diffs-container") ?? []).some((host) => {
        if (!(host instanceof HTMLElement)) return false
        const root = host.shadowRoot
        return root?.textContent?.includes(`mark ${mark}`) ?? false
      })
    },
    { file, mark },
    { timeout: 60_000 },
  )
}

test("review keeps scroll position after a live diff update", async ({ page, withProject }) => {
  test.setTimeout(180_000)

  const tag = `review-${Date.now()}`
  const list = files(tag)
  const hit = list[list.length - 2]!
  const next = `${tag}-live`

  await page.setViewportSize({ width: 1600, height: 1000 })

  await withProject(async (project) => {
    const sdk = createSdk(project.directory)

    await withSession(sdk, `e2e review ${tag}`, async (session) => {
      await patch(sdk, session.id, seed(list))

      await expect
        .poll(
          async () => {
            const info = await sdk.session.get({ sessionID: session.id }).then((res) => res.data)
            return info?.summary?.files ?? 0
          },
          { timeout: 60_000 },
        )
        .toBe(list.length)

      await expect
        .poll(
          async () => {
            const diff = await sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
            return diff.length
          },
          { timeout: 60_000 },
        )
        .toBe(list.length)

      await project.gotoSession(session.id)
      await show(page)

      const tab = page.getByRole("tab", { name: /Review/i }).first()
      await expect(tab).toBeVisible()
      await tab.click()

      const view = page.locator('[data-slot="session-review-scroll"] .scroll-view__viewport').first()
      await expect(view).toBeVisible()
      const heads = page.getByRole("heading", { level: 3 }).filter({ hasText: /^review-scroll-/ })
      await expect(heads).toHaveCount(list.length, {
        timeout: 60_000,
      })

      await expand(page)
      await waitMark(page, hit.file, hit.mark)

      const row = page
        .getByRole("heading", { level: 3, name: new RegExp(hit.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
        .first()
      await expect(row).toBeVisible()
      await row.evaluate((el) => el.scrollIntoView({ block: "center" }))

      await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(200)
      const prev = await view.evaluate((el) => el.scrollTop)

      await patch(sdk, session.id, edit(hit.file, hit.mark, next))

      await expect
        .poll(
          async () => {
            const diff = await sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
            const item = diff.find((item) => item.file === hit.file)
            return typeof item?.after === "string" ? item.after : ""
          },
          { timeout: 60_000 },
        )
        .toContain(`mark ${next}`)

      await waitMark(page, hit.file, next)

      await expect
        .poll(async () => Math.abs((await view.evaluate((el) => el.scrollTop)) - prev), { timeout: 60_000 })
        .toBeLessThanOrEqual(16)
    })
  })
})
