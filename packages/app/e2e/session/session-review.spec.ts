import { waitSessionIdle, withSession } from "../actions"
import { test, expect } from "../fixtures"
import { bodyText } from "../prompt/mock"

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

async function patchWithMock(
  llm: Parameters<typeof test>[0]["llm"],
  sdk: Parameters<typeof withSession>[0],
  sessionID: string,
  patchText: string,
) {
  const callsBefore = await llm.calls()
  await llm.toolMatch(
    (hit) => bodyText(hit).includes("Your only valid response is one apply_patch tool call."),
    "apply_patch",
    { patchText },
  )
  await sdk.session.prompt({
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

  await expect.poll(() => llm.calls().then((c) => c > callsBefore), { timeout: 30_000 }).toBe(true)
  await expect
    .poll(
      async () => {
        const diff = await sdk.session.diff({ sessionID }).then((res) => res.data ?? [])
        return diff.length
      },
      { timeout: 120_000 },
    )
    .toBeGreaterThan(0)
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
      const view = document.querySelector('[data-slot="session-review-scroll"] .scroll-view__viewport')
      if (!(view instanceof HTMLElement)) return false

      const head = Array.from(view.querySelectorAll("h3")).find(
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

async function spot(page: Parameters<typeof test>[0]["page"], file: string) {
  return page.evaluate((file) => {
    const view = document.querySelector('[data-slot="session-review-scroll"] .scroll-view__viewport')
    if (!(view instanceof HTMLElement)) return null

    const row = Array.from(view.querySelectorAll("h3")).find(
      (node) => node instanceof HTMLElement && node.textContent?.includes(file),
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

async function comment(page: Parameters<typeof test>[0]["page"], file: string, note: string) {
  const row = page.locator(`[data-file="${file}"]`).first()
  await expect(row).toBeVisible()

  const line = row.locator('diffs-container [data-line="2"]').first()
  await expect(line).toBeVisible()
  await line.hover()

  const add = row.getByRole("button", { name: /^Comment$/ }).first()
  await expect(add).toBeVisible()
  await add.click()

  const area = row.locator('[data-slot="line-comment-textarea"]').first()
  await expect(area).toBeVisible()
  await area.fill(note)

  const submit = row.locator('[data-slot="line-comment-action"][data-variant="primary"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(row.locator('[data-slot="line-comment-content"]').filter({ hasText: note }).first()).toBeVisible()
  await expect(row.locator('[data-slot="line-comment-tools"]').first()).toBeVisible()
}

async function overflow(page: Parameters<typeof test>[0]["page"], file: string) {
  const row = page.locator(`[data-file="${file}"]`).first()
  const view = page.locator('[data-slot="session-review-scroll"] .scroll-view__viewport').first()
  const pop = row.locator('[data-slot="line-comment-popover"][data-inline-body]').first()
  const tools = row.locator('[data-slot="line-comment-tools"]').first()

  const [width, viewBox, popBox, toolsBox] = await Promise.all([
    view.evaluate((el) => el.scrollWidth - el.clientWidth),
    view.boundingBox(),
    pop.boundingBox(),
    tools.boundingBox(),
  ])

  if (!viewBox || !popBox || !toolsBox) return null

  return {
    width,
    pop: popBox.x + popBox.width - (viewBox.x + viewBox.width),
    tools: toolsBox.x + toolsBox.width - (viewBox.x + viewBox.width),
  }
}

async function openReviewFile(page: Parameters<typeof test>[0]["page"], file: string) {
  const row = page.locator(`[data-file="${file}"]`).first()
  await expect(row).toBeVisible()
  await row.hover()

  const open = row.getByRole("button", { name: /^Open file$/i }).first()
  await expect(open).toBeVisible()
  await open.click()

  const tab = page.getByRole("tab", { name: file }).first()
  await expect(tab).toBeVisible()
  await tab.click()

  const viewer = page.locator('[data-component="file"][data-mode="text"]').first()
  await expect(viewer).toBeVisible()
  return viewer
}

async function fileComment(page: Parameters<typeof test>[0]["page"], note: string) {
  const viewer = page.locator('[data-component="file"][data-mode="text"]').first()
  await expect(viewer).toBeVisible()

  const line = viewer.locator('diffs-container [data-line="2"]').first()
  await expect(line).toBeVisible()
  await line.hover()

  const add = viewer.getByRole("button", { name: /^Comment$/ }).first()
  await expect(add).toBeVisible()
  await add.click()

  const area = viewer.locator('[data-slot="line-comment-textarea"]').first()
  await expect(area).toBeVisible()
  await area.fill(note)

  const submit = viewer.locator('[data-slot="line-comment-action"][data-variant="primary"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(viewer.locator('[data-slot="line-comment-content"]').filter({ hasText: note }).first()).toBeVisible()
  await expect(viewer.locator('[data-slot="line-comment-tools"]').first()).toBeVisible()
}

async function fileOverflow(page: Parameters<typeof test>[0]["page"]) {
  const viewer = page.locator('[data-component="file"][data-mode="text"]').first()
  const view = page.locator('[role="tabpanel"] .scroll-view__viewport').first()
  const pop = viewer.locator('[data-slot="line-comment-popover"][data-inline-body]').first()
  const tools = viewer.locator('[data-slot="line-comment-tools"]').first()

  const [width, viewBox, popBox, toolsBox] = await Promise.all([
    view.evaluate((el) => el.scrollWidth - el.clientWidth),
    view.boundingBox(),
    pop.boundingBox(),
    tools.boundingBox(),
  ])

  if (!viewBox || !popBox || !toolsBox) return null

  return {
    width,
    pop: popBox.x + popBox.width - (viewBox.x + viewBox.width),
    tools: toolsBox.x + toolsBox.width - (viewBox.x + viewBox.width),
  }
}

test("review applies inline comment clicks without horizontal overflow", async ({ page, llm, project }) => {
  test.setTimeout(180_000)

  const tag = `review-comment-${Date.now()}`
  const file = `review-comment-${tag}.txt`
  const note = `comment ${tag}`

  await page.setViewportSize({ width: 1280, height: 900 })

  await project.open()
  await withSession(project.sdk, `e2e review comment ${tag}`, async (session) => {
    project.trackSession(session.id)
    await patchWithMock(llm, project.sdk, session.id, seed([{ file, mark: tag }]))

    await expect
      .poll(
        async () => {
          const diff = await project.sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
          return diff.length
        },
        { timeout: 60_000 },
      )
      .toBe(1)

    await project.gotoSession(session.id)
    await show(page)

    const tab = page.getByRole("tab", { name: /Review/i }).first()
    await expect(tab).toBeVisible()
    await tab.click()

    await expand(page)
    await waitMark(page, file, tag)
    await comment(page, file, note)

    await expect
      .poll(async () => (await overflow(page, file))?.width ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
      .toBeLessThanOrEqual(1)
    await expect
      .poll(async () => (await overflow(page, file))?.pop ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
      .toBeLessThanOrEqual(1)
    await expect
      .poll(async () => (await overflow(page, file))?.tools ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
      .toBeLessThanOrEqual(1)
  })
})

test("review file comments submit on click without clipping actions", async ({ page, llm, project }) => {
  test.setTimeout(180_000)

  const tag = `review-file-comment-${Date.now()}`
  const file = `review-file-comment-${tag}.txt`
  const note = `comment ${tag}`

  await page.setViewportSize({ width: 1280, height: 900 })

  await project.open()
  await withSession(project.sdk, `e2e review file comment ${tag}`, async (session) => {
    project.trackSession(session.id)
    await patchWithMock(llm, project.sdk, session.id, seed([{ file, mark: tag }]))

    await expect
      .poll(
        async () => {
          const diff = await project.sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
          return diff.length
        },
        { timeout: 60_000 },
      )
      .toBe(1)

    await project.gotoSession(session.id)
    await show(page)

    const tab = page.getByRole("tab", { name: /Review/i }).first()
    await expect(tab).toBeVisible()
    await tab.click()

    await expand(page)
    await waitMark(page, file, tag)
    await openReviewFile(page, file)
    await fileComment(page, note)

    await expect
      .poll(async () => (await fileOverflow(page))?.width ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
      .toBeLessThanOrEqual(1)
    await expect
      .poll(async () => (await fileOverflow(page))?.pop ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
      .toBeLessThanOrEqual(1)
    await expect
      .poll(async () => (await fileOverflow(page))?.tools ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
      .toBeLessThanOrEqual(1)
  })
})

test.fixme("review keeps scroll position after a live diff update", async ({ page, llm, project }) => {
  test.setTimeout(180_000)

  const tag = `review-${Date.now()}`
  const list = files(tag)
  const hit = list[list.length - 4]!
  const next = `${tag}-live`

  await page.setViewportSize({ width: 1600, height: 1000 })

  await project.open()
  await withSession(project.sdk, `e2e review ${tag}`, async (session) => {
    project.trackSession(session.id)
    await patchWithMock(llm, project.sdk, session.id, seed(list))

    await expect
      .poll(
        async () => {
          const info = await project.sdk.session.get({ sessionID: session.id }).then((res) => res.data)
          return info?.summary?.files ?? 0
        },
        { timeout: 60_000 },
      )
      .toBe(list.length)

    await expect
      .poll(
        async () => {
          const diff = await project.sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
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
    await expect(heads).toHaveCount(list.length, { timeout: 60_000 })

    await expand(page)
    await waitMark(page, hit.file, hit.mark)

    const row = page
      .getByRole("heading", {
        level: 3,
        name: new RegExp(hit.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      })
      .first()
    await expect(row).toBeVisible()
    await row.evaluate((el) => el.scrollIntoView({ block: "center" }))

    await expect.poll(async () => (await spot(page, hit.file))?.y ?? 0).toBeGreaterThan(200)
    const prev = await spot(page, hit.file)
    if (!prev) throw new Error(`missing review row for ${hit.file}`)

    await patchWithMock(llm, project.sdk, session.id, edit(hit.file, hit.mark, next))

    await expect
      .poll(
        async () => {
          const diff = await project.sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
          const item = diff.find((item) => item.file === hit.file)
          return typeof item?.after === "string" ? item.after : ""
        },
        { timeout: 60_000 },
      )
      .toContain(`mark ${next}`)

    await waitMark(page, hit.file, next)

    await expect
      .poll(
        async () => {
          const next = await spot(page, hit.file)
          if (!next) return Number.POSITIVE_INFINITY
          return Math.max(Math.abs(next.top - prev.top), Math.abs(next.y - prev.y))
        },
        { timeout: 60_000 },
      )
      .toBeLessThanOrEqual(32)
  })
})
