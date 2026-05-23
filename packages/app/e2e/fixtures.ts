// FORK: e2e 测试 fixture
// [feat: e2e-phase1-mock-mode] 2026-05-23 W2 D8 起 — 扩展原 Stage ② installServerMock
//
// 双层 mock 架构(参 docs/features/e2e-phase1-mock-mode/2-plan.md W2 D8 note):
//   ① **Playwright `page.route` 拦 SDK HTTP**(本文件) — 拦截 4096 端口,Node 端 mock 数据
//   ② **Vite alias 拦 Tauri invoke**(packages/app/vite/e2e-mock.js) — 浏览器端走 memfs
//   ③ **memfs 暴露到 window.__deskfoxE2eMemfs**(tauri.ts 注入)— fixture 跨进程同步数据
//
// Stage ② 的简化 catch-all 仍是默认行为(GET 返 [],POST 返 ok),让 UI 能 hydrate;
// W2 起加 `mockProject` / `mockFile` 等 helper,spec 显式注入"真实数据"路由让 UI 走到业务路径。
//
// 限制 / 边界:
// - 只测 UI 渲染 / 路由 / reactive 行为 / 数据流;不测真后端联调(Phase 2 真 Tauri 兜)
// - 跨进程数据同步靠 fixture 双面写入(page.evaluate + page.route handler 闭包),不会自动一致

import { test as base, expect, type Page } from "@playwright/test"

const SERVER_HOST = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
const SERVER_PORT = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
const SERVER_PATTERN = `**://${SERVER_HOST}:${SERVER_PORT}/**`

/** 默认 catch-all server mock — Stage ② 行为保留:GET 返空数组,POST 返 ok */
export async function installServerMock(page: Page): Promise<void> {
  await page.route(SERVER_PATTERN, (route) => {
    const url = route.request().url()
    const method = route.request().method()
    if (url.includes("/global/health")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", mock: true }),
      })
    }
    if (method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], items: [], mock: true }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, mock: true }),
    })
  })
}

// ============== W2 D8 业务级 mock helper ==============

/** 项目数据 shape — 对照 SDK ProjectListResponses(简化) */
export interface MockProject {
  id: string
  worktree: string
  vcs?: "git" | undefined
  time: { created: number }
}

/**
 * 注入项目列表 — 拦 `GET /project` 返指定项目数组
 * 注:此 route 优先级高于 catch-all(后注册的 route 先匹配)
 */
export async function mockProject(page: Page, projects: MockProject[] | MockProject): Promise<void> {
  const arr = Array.isArray(projects) ? projects : [projects]
  // 用 glob '**/project'(末尾不 trailing,精准匹配)+ '**/project/current'
  await page.route("**/project", (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(arr),
    })
  })
  await page.route("**/project/current", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(arr[0] ?? null),
    })
  })
}

/**
 * 预加载文件到 memfs(浏览器端)+ 同时拦 `GET /file/content?path=...`(Node 端)
 * 双面写入保证 Tauri invoke 和 SDK file.read 两路 mock 数据一致
 */
export async function preloadFile(page: Page, path: string, content: string): Promise<void> {
  // 1. 注入浏览器 memfs
  await page.evaluate(
    ({ p, c }) => {
      const w = window as unknown as {
        __deskfoxE2eMemfs?: { preload(files: Record<string, string>): void }
      }
      w.__deskfoxE2eMemfs?.preload({ [p]: c })
    },
    { p: path, c: content },
  )

  // 2. 拦 SDK file.read(`GET /file/content?path=...`)返同样内容
  // 用 glob + handler 内手动 match path query
  await page.route("**/file/content", (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get("path") !== path) return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ type: "text", content }),
    })
  })
}

/**
 * 拦 `GET /file?path=...`(file.list)返 memfs.list 结果
 * 注:文件层级模拟简单 — memfs 已用前缀模拟目录,这里直接 page.evaluate 调
 */
export async function mockFileTree(page: Page, files: Record<string, string>): Promise<void> {
  // 1. preload 全部文件到 memfs
  await page.evaluate((fs) => {
    const w = window as unknown as {
      __deskfoxE2eMemfs?: { preload(files: Record<string, string>): void; reset(): void }
    }
    w.__deskfoxE2eMemfs?.reset()
    w.__deskfoxE2eMemfs?.preload(fs)
  }, files)

  // 2. 拦 GET /file?path=... 返 memfs.list(用 glob 而非 RegExp,Playwright RegExp 行为不稳定)
  await page.route(
    "**/file",
    async (route) => {
      const url = new URL(route.request().url())
      const dir = url.searchParams.get("path") ?? ""
      const items = await page.evaluate((d) => {
        const w = window as unknown as {
          __deskfoxE2eMemfs?: {
            list(dir: string): Array<{ name: string; isDir: boolean; size: number; mtime: number }>
          }
        }
        return w.__deskfoxE2eMemfs?.list(d) ?? []
      }, dir)
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(items),
      })
    },
  )
}

/** 重置浏览器 memfs(spec 之间隔离用)*/
export async function resetMemfs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __deskfoxE2eMemfs?: { reset(): void } }
    w.__deskfoxE2eMemfs?.reset()
  })
}

// ============== 扩展 base test:自动装 catch-all mock ==============

export const test = base.extend<{ mockedPage: Page }>({
  mockedPage: async ({ page }, use) => {
    await installServerMock(page)
    await use(page)
  },
})

export { expect }
