// FORK: md-editing-iter-3 视觉自测 spec
// [feat: md-editing-iter-3] 2026-05-25
//
// 端到端验证 iter-3 编辑态语义高亮 — 加载 markdown-test-fixture.md → 点开 → 切编辑 →
// 断言 CodeMirror 编辑器视觉:heading 字号梯度 / 代码块语法高亮(default fallback)/
// 链接蓝色(text-interactive-base)/ 删除线 / 标记符弱化。
//
// 取代 user 手测 + 截图反复迭代;以后 markdown 编辑器调整全走这 spec。

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  test,
  expect,
  installServerMock,
  bootstrapMock,
  mockFileTree,
  preloadFile,
} from "./fixtures"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MD_FIXTURE_PATH = join(__dirname, "mocks", "markdown-test-fixture.md")
const MD_CONTENT = readFileSync(MD_FIXTURE_PATH, "utf-8")

test("[md-editing-iter-3] 编辑器视觉:heading 梯度 / 代码块高亮 / 链接蓝 / 删除线 / 标记符弱化", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(`PAGE: ${e.message}`))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`CONSOLE: ${msg.text()}`)
  })

  // 让 isTauri() 返 true(canEdit() 解禁,"编辑"菜单项 enabled)
  // 加 transformCallback stub 防 Tauri @tauri-apps/api 在某些路径调时报错
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

  // preload fixture(必须 click workspace 之前)
  await mockFileTree(page, { "markdown-test.md": MD_CONTENT })
  await preloadFile(page, "markdown-test.md", MD_CONTENT)

  // 兜底:fixtures.preloadFile 用 glob `**/file/content` 在某些 Playwright 版本下
  // 不匹配带 query string 的 URL。用 RegExp 显式拦,保证 file.read 返期望 shape
  await page.route(/\/file\/content\?/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ type: "text", content: MD_CONTENT }),
    }),
  )

  // 进 workspace 触发 file.list
  await page.locator('text="/mock/workspace"').first().click()
  await page.waitForTimeout(2000)

  // 点文件树里的 markdown-test.md
  await page.locator('button:has-text("markdown-test.md")').first().click()
  await page.waitForTimeout(2500)

  // === 验 preview 已渲染(看到 markdown 文档主标题)===
  await expect(
    page.getByText("Markdown 综合测试文档", { exact: false }).first(),
  ).toBeVisible({ timeout: 5000 })

  // === 右键文档区域 → 编辑 ===
  // 右键文档主区域(避开聊天 panel + file tree)
  const docArea = page.locator('[data-component="markdown"], [data-slot="md-document"]').first()
  if ((await docArea.count()) === 0) {
    // 退化:右键 body 中央位置
    const viewport = page.viewportSize() ?? { width: 1440, height: 900 }
    await page.mouse.click(viewport.width / 2, viewport.height / 2, { button: "right" })
  } else {
    await docArea.click({ button: "right" })
  }
  await page.waitForTimeout(500)

  // 点 "Edit / 编辑" 菜单项(i18n locale 跟环境跑,兼容中英)
  const editMenuBtn = page
    .locator('[data-slot="md-selection-menu"] button')
    .filter({ hasText: /^(编辑|Edit)\s*$/ })
    .first()
  await expect(editMenuBtn).toBeVisible({ timeout: 3000 })
  await editMenuBtn.click()

  // === 等 CodeMirror 编辑器渲染 ===
  await expect(page.locator(".cm-editor").first()).toBeVisible({ timeout: 5000 })
  await page.waitForTimeout(1500) // CM6 highlight 异步应用

  // === 断言 1-2:heading 梯度(在 .cm-content 里遍历所有 line,按 markdown 前缀分类)===
  const headingSizes = await page.locator(".cm-content").first().evaluate((root) => {
    const bodyFontSize = parseFloat(window.getComputedStyle(root).fontSize)
    const lines = root.querySelectorAll(".cm-line")
    const result: Record<string, number[]> = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] }
    for (const line of Array.from(lines)) {
      const text = (line as HTMLElement).textContent ?? ""
      // 用前缀识别 heading 级别(# 数 = 级别)
      const m = /^(#+)\s/.exec(text.trimStart())
      if (!m) continue
      const level = m[1].length
      if (level < 1 || level > 6) continue
      // 取该行 styled span 的 font-size(可能有多个 span,取最大)
      const spans = line.querySelectorAll("span")
      let maxFont = 0
      for (const s of Array.from(spans)) {
        const fs = parseFloat(window.getComputedStyle(s).fontSize)
        if (!Number.isNaN(fs) && fs > maxFont) maxFont = fs
      }
      const key = `h${level}` as keyof typeof result
      if (maxFont > 0) result[key].push(maxFont)
    }
    return { bodyFontSize, sizes: result }
  })
  const bodyFontSize = headingSizes.bodyFontSize
  console.log(`[iter-3 spec] body font-size: ${bodyFontSize}px`)
  console.log(`[iter-3 spec] heading sizes:`, headingSizes.sizes)
  // 至少要有 h1 / h2 / h3 样本
  expect(headingSizes.sizes.h1.length).toBeGreaterThan(0)
  expect(headingSizes.sizes.h2.length).toBeGreaterThan(0)
  expect(headingSizes.sizes.h3.length).toBeGreaterThan(0)
  // h1 ≈ 2em = body × 2(允许 ±10% 容差)
  const h1Sample = headingSizes.sizes.h1[0]
  expect(h1Sample).toBeGreaterThan(bodyFontSize * 1.7)
  expect(h1Sample).toBeLessThan(bodyFontSize * 2.3)
  // h2 ≈ 1.5em
  const h2Sample = headingSizes.sizes.h2[0]
  expect(h2Sample).toBeGreaterThan(bodyFontSize * 1.3)
  expect(h2Sample).toBeLessThan(bodyFontSize * 1.7)
  // h3 ≈ 1.25em
  const h3Sample = headingSizes.sizes.h3[0]
  expect(h3Sample).toBeGreaterThan(bodyFontSize * 1.1)
  expect(h3Sample).toBeLessThan(bodyFontSize * 1.4)
  // 单调递减
  expect(h1Sample).toBeGreaterThan(h2Sample)
  expect(h2Sample).toBeGreaterThan(h3Sample)

  // === 断言 3:链接应用 text-interactive-base 色(蓝色 ≈ #034cff)===
  // 找 markdown link 出现的 line,验证至少一个 span 是 blue
  // light mode: #034cff = rgb(3, 76, 255) / dark mode: #9dbefe ≈ rgb(157, 190, 254)
  // 用宽松判断:R < G < B 且 B 显著高(blue dominance)
  const linkColors = await page.locator(".cm-content").first().evaluate((root) => {
    const lines = root.querySelectorAll(".cm-line")
    const allColors = new Set<string>()
    for (const line of Array.from(lines)) {
      const text = (line as HTMLElement).textContent ?? ""
      // 关注含 markdown 链接语法 [text](url) 或 URL 的 line
      if (!/\[.+?\]\(.+?\)|https?:\/\//.test(text)) continue
      for (const s of Array.from(line.querySelectorAll("span"))) {
        const c = window.getComputedStyle(s).color
        if (c) allColors.add(c)
      }
    }
    return Array.from(allColors)
  })
  console.log(`[iter-3 spec] colors on link-containing lines:`, linkColors)
  // 找 blue dominance:R < B 且 B - R > 100(粗略蓝色)
  const hasBlue = linkColors.some((c) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c)
    if (!m) return false
    const r = parseInt(m[1], 10), g = parseInt(m[2], 10), b = parseInt(m[3], 10)
    return b > r + 50 && b > g + 30 // 蓝色主导
  })
  expect(hasBlue).toBe(true)

  // === 断言 4:删除线 `~~text~~` 的 t.strikethrough spec 应用 text-decoration ===
  // 找含 "删除线" 的 line(2. 文本样式段有 ~~删除线 (Strikethrough)~~)
  const strikeLine = page.locator('.cm-line:has-text("删除线")').first()
  if ((await strikeLine.count()) > 0) {
    const hasStrike = await strikeLine.evaluate((el) => {
      const spans = el.querySelectorAll("span")
      for (const s of Array.from(spans)) {
        const td = window.getComputedStyle(s).textDecoration
        if (td.includes("line-through")) return true
      }
      return false
    })
    console.log(`[iter-3 spec] strikethrough applied: ${hasStrike}`)
    expect(hasStrike).toBe(true)
  }

  // === 断言 5:JS 代码块 default 高亮真生效 — 严格判断(矫正 ⑤ 后)===
  // CodeMirror 6 viewport 优化:必须先滚到代码块附近,line 才进 DOM
  // 滚到约 2500px(JS 代码块在 line 149 附近,每行约 19.5px → 2900px)
  await page.evaluate(() => {
    const sv = document.querySelector(".scroll-view__viewport") as HTMLElement | null
    if (sv) sv.scrollTop = 3000
  })
  await page.waitForTimeout(800) // 等 CM viewport re-render

  const jsTokenInfo = await page.locator(".cm-content").first().evaluate((root) => {
    const lines = Array.from(root.querySelectorAll(".cm-line"))
    // 找文本含 function / fibonacci / interface 等 — 多种探测
    const targets = lines.filter((l) => {
      const t = (l as HTMLElement).textContent ?? ""
      return /function|fibonacci|interface\s+\w|useState|SELECT\s+\w/.test(t)
    })
    const colors = new Set<string>()
    const samples: string[] = []
    for (const line of targets.slice(0, 5)) {
      samples.push((line as HTMLElement).textContent?.slice(0, 60) ?? "")
      for (const s of Array.from(line.querySelectorAll("span"))) {
        const c = window.getComputedStyle(s).color
        if (c) colors.add(c)
      }
    }
    return { sampleLines: samples, colors: Array.from(colors), matchedCount: targets.length }
  })
  console.log(`[iter-3 spec] JS matched lines (${jsTokenInfo.matchedCount}):`, jsTokenInfo.sampleLines)
  console.log(`[iter-3 spec] JS keyword line colors:`, jsTokenInfo.colors)
  const jsTokenColors = jsTokenInfo.colors
  // 排除 text-base #6f6f6f / text-weak #8f8f8f 灰色调,看是否真有"keyword 色"
  // 灰色判定:R≈G≈B(差距 ≤ 10)
  const nonGrayColors = jsTokenColors.filter((c) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c)
    if (!m) return false
    const r = parseInt(m[1], 10), g = parseInt(m[2], 10), b = parseInt(m[3], 10)
    return Math.abs(r - g) > 15 || Math.abs(g - b) > 15 || Math.abs(r - b) > 15
  })
  console.log(`[iter-3 spec] JS non-gray (真彩色) tokens:`, nonGrayColors)
  // 矫正 ⑤ 后 default highlight 应该让 keyword 等带真彩色(非灰)
  expect(nonGrayColors.length).toBeGreaterThanOrEqual(1)

  // === 断言 6:标记符 # ** opacity 弱化 ===
  // 找含 `# 1. 标题层级` 的 line,看 # 部分 opacity
  const headingLine = page
    .locator('.cm-line:has-text("1. 标题层级")')
    .first()
  if ((await headingLine.count()) > 0) {
    const minOpacity = await headingLine.evaluate((el) => {
      const spans = el.querySelectorAll("span")
      let min = 1
      for (const s of Array.from(spans)) {
        const o = parseFloat(window.getComputedStyle(s).opacity)
        if (!Number.isNaN(o) && o < min) min = o
      }
      return min
    })
    console.log(`[iter-3 spec] heading marker min opacity: ${minOpacity}`)
    expect(minOpacity).toBeLessThan(0.95) // 期望 0.7(我们 spec)< 0.95
  }

  // === 截图存档(失败/通过都有视觉记录,放 e2e/test-results 对齐 .gitignore)===
  await page.locator(".cm-editor").first().screenshot({
    path: "e2e/test-results/md-editing-iter-3-visual.png",
    animations: "disabled",
  })

  // === 0 fatal console error(e2e-mock 噪音过滤)===
  const fatalErrors = errors.filter(
    (e) =>
      !e.includes("ResizeObserver") &&
      !e.includes("Failed to load resource") &&
      !e.includes("queryFn when set to skipToken") && // bootstrapMock provider 路由未注入,不影响 md viewer
      !e.includes("__TAURI_INTERNALS__"), // mock shim 接近真 Tauri 但 surface 不全,markdown viewer 路径不依赖
  )
  console.log(`[iter-3 spec] non-fatal errors:`, errors.length, `fatal:`, fatalErrors.length)
  expect(fatalErrors).toHaveLength(0)
})
