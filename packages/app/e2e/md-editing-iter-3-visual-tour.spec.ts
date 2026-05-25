// FORK: md-editing-iter-3 完整视觉巡检 spec
// [feat: md-editing-iter-3] 2026-05-25
//
// 不做断言,只捕获完整文档视觉档案 — 大视口 1920×1080 + 进编辑模式 + 滚动 N 张截图
// 输出:e2e/test-results/iter-3-tour/section-NN.png
// 用途:user 想看完整效果时跑这个,AI 也可读截图自检

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  test,
  installServerMock,
  bootstrapMock,
  mockFileTree,
  preloadFile,
} from "./fixtures"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MD_FIXTURE_PATH = join(__dirname, "mocks", "markdown-test-fixture.md")
const MD_CONTENT = readFileSync(MD_FIXTURE_PATH, "utf-8")

test.use({ viewport: { width: 1920, height: 1080 } })

test("[md-editing-iter-3 巡检] 滚动捕获完整文档视觉档案", async ({ page }) => {
  await page.addInitScript(() => {
    ;(
      window as unknown as { __TAURI_INTERNALS__?: { transformCallback: (cb: unknown) => number } }
    ).__TAURI_INTERNALS__ = { transformCallback: () => 0 }
  })

  await installServerMock(page)
  await bootstrapMock(page)
  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(2000)

  await mockFileTree(page, { "markdown-test.md": MD_CONTENT })
  await preloadFile(page, "markdown-test.md", MD_CONTENT)
  await page.route(/\/file\/content\?/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ type: "text", content: MD_CONTENT }),
    }),
  )

  await page.locator('text="/mock/workspace"').first().click()
  await page.waitForTimeout(2000)
  await page.locator('button:has-text("markdown-test.md")').first().click()
  await page.waitForTimeout(2500)

  // 右键 → 编辑
  const docArea = page.locator('[data-component="markdown"], [data-slot="md-document"]').first()
  if ((await docArea.count()) === 0) {
    const viewport = page.viewportSize() ?? { width: 1920, height: 1080 }
    await page.mouse.click(viewport.width / 2, viewport.height / 2, { button: "right" })
  } else {
    await docArea.click({ button: "right" })
  }
  await page.waitForTimeout(500)
  const editBtn = page
    .locator('[data-slot="md-selection-menu"] button')
    .filter({ hasText: /^(编辑|Edit)\s*$/ })
    .first()
  await editBtn.click()
  await page.waitForTimeout(2000)

  // 拿编辑器
  const editor = page.locator(".cm-editor").first()
  await editor.waitFor({ state: "visible" })
  await page.waitForTimeout(2000) // CM full render

  // 找真正的滚动容器:外层 viewport 滚动还是 .cm-scroller 内部滚动?试两个
  const probeInfo = await page.evaluate(() => {
    const sel = (s: string) => document.querySelector(s) as HTMLElement | null
    const editor = sel(".cm-editor")
    const scroller = sel(".cm-scroller")
    const content = sel(".cm-content")
    // 找 ancestor 中有 overflow:auto 且 sh>ch 的
    let ancestor: HTMLElement | null = editor?.parentElement ?? null
    let scrollableAncestor: HTMLElement | null = null
    while (ancestor && !scrollableAncestor) {
      const cs = window.getComputedStyle(ancestor)
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && ancestor.scrollHeight > ancestor.clientHeight + 5) {
        scrollableAncestor = ancestor
      }
      ancestor = ancestor.parentElement
    }
    return {
      editor: editor ? { sh: editor.scrollHeight, ch: editor.clientHeight } : null,
      scroller: scroller ? { sh: scroller.scrollHeight, ch: scroller.clientHeight } : null,
      content: content ? { sh: content.scrollHeight, ch: content.clientHeight } : null,
      window: { sh: document.documentElement.scrollHeight, ch: window.innerHeight },
      scrollableAncestor: scrollableAncestor
        ? {
            tag: scrollableAncestor.tagName,
            cls: scrollableAncestor.className,
            sh: scrollableAncestor.scrollHeight,
            ch: scrollableAncestor.clientHeight,
          }
        : null,
    }
  })
  console.log(`[tour] DOM info:`, JSON.stringify(probeInfo))

  // 滚 .scroll-view__viewport(外层 ScrollView)+ 截 viewport
  const viewport = page.viewportSize() ?? { width: 1920, height: 1080 }
  const step = 850

  for (let i = 0; i < 20; i++) {
    const top = i * step
    await page.evaluate((t) => {
      const sv = document.querySelector(".scroll-view__viewport") as HTMLElement | null
      if (sv) sv.scrollTop = t
    }, top)
    await page.waitForTimeout(400)

    const name = `view-${String(i).padStart(2, "0")}.png`
    await page.screenshot({
      path: `e2e/test-results/iter-3-tour/${name}`,
      clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      animations: "disabled",
    })
    const cur = await page.evaluate(() => {
      const sv = document.querySelector(".scroll-view__viewport") as HTMLElement | null
      return {
        top: sv?.scrollTop ?? -1,
        max: (sv?.scrollHeight ?? 0) - (sv?.clientHeight ?? 0),
      }
    })
    console.log(`[tour] ${name} scrollTop=${cur.top} / max=${cur.max}`)
    if (cur.top >= cur.max - 5) {
      console.log(`[tour] reached bottom at i=${i}`)
      break
    }
  }
})
