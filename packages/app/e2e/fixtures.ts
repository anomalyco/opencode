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
// 用 host-agnostic pattern — 前端实际可能用 localhost / 127.0.0.1 / ::1 等 alias
// (W3 D16 实测:SDK 走 localhost,而 SERVER_HOST 默认 127.0.0.1 不 match → ERR_CONNECTION_REFUSED)
const SERVER_PATTERN = `**:${SERVER_PORT}/**`

/** 默认 catch-all server mock — GET 返 raw array(SDK 大部分 list endpoint 期望 array),POST 返 ok
 *
 * W3 D16 实测:Stage ② 原版返 `{data:[], items:[], mock:true}` 让 SDK gen `.filter` / `.map` 报错
 * (SDK 拿 HTTP body 直接当 list,加 `{data:..}` wrap 会把 object 当 list 失败)。
 * 现在 GET 默认返 `[]` raw array;object-shape endpoint(Config/Path 等)走 specific 路由不走 catch-all。
 */
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
        body: JSON.stringify([]),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, mock: true }),
    })
  })
}

// ============== W3 D15 bootstrap mock — 让 UI 进入 ready 状态 ==============
// 必须 4 个 query 全过(参 e2e/mocks/BOOTSTRAP-MOCK.md §一):
//   /global/config / /provider / /path / /project
// + SSE /global/event 走 catch-all(catch error → reconnect,不 hang reactive)

export interface BootstrapMockOptions {
  /** 路径配置(覆盖默认 mock workspace 路径)*/
  paths?: Partial<{ home: string; state: string; config: string; worktree: string; directory: string }>
  /** 项目列表(默认一个 mock 项目)*/
  projects?: MockProject[]
  /** Config 覆盖(默认空对象 — Config 所有字段 optional,空 {} 即可)*/
  config?: Record<string, unknown>
}

const DEFAULT_PATHS = {
  home: "/mock/home",
  state: "/mock/state",
  config: "/mock/config",
  worktree: "/mock/workspace",
  directory: "/mock/workspace",
}

const DEFAULT_PROJECTS: MockProject[] = [
  {
    id: "e2e-mock-project",
    worktree: "/mock/workspace",
    vcs: undefined,
    time: { created: Date.now() },
  },
]

/**
 * 一次性装齐 bootstrap 4 个 query — UI 才能进入 ready 状态
 * 必须在 page.goto 前 await(后注册 catch-all 兜底)
 */
export async function bootstrapMock(page: Page, opts: BootstrapMockOptions = {}): Promise<void> {
  const paths = { ...DEFAULT_PATHS, ...opts.paths }
  const projects = opts.projects ?? DEFAULT_PROJECTS
  const config = opts.config ?? {}

  // 1. GET /global/config
  await page.route("**/global/config", (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(config),
    })
  })

  // 2. GET /provider
  await page.route("**/provider", (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ all: [], default: {}, connected: [] }),
    })
  })

  // 3. GET /path
  await page.route("**/path", (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(paths),
    })
  })

  // 4. GET /project — 复用 mockProject
  await mockProject(page, projects)

  // SSE /global/event — 走 catch-all(SDK catch error reconnect,不 hang)
  // 如果 reactive 链卡了,W3 D16 加专门 SSE mock(返 chunked empty stream)
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
 * 拦 `GET /file?path=...`(file.list)返 memfs.list 结果(已 shape 转换成 SDK FileNode)
 * 注:文件层级模拟简单 — memfs 已用前缀模拟目录,这里直接 page.evaluate 调
 *
 * W3 D17+:memfs.list 返 `{name,isDir,size,mtime}`,SDK 期望 `{name,path,absolute,type,ignored}`(FileNode);
 * 之前 mock-foundation smoke 不点文件树没踩到,bug-repro 系列点文件触发后修(2026-05-23)
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

  // 2. 拦 GET /file?path=... 返 memfs.list 转 SDK FileNode shape
  // 用 RegExp 而非 glob — Playwright glob `**/file` 不匹配带 ?path=... query string 的 URL
  await page.route(
    /\/file(\?|$)/,
    async (route) => {
      const url = new URL(route.request().url())
      // 排除 /file/content 和 /file/xxx 子路径(那些已经匹配下方专门 route)
      if (url.pathname !== "/file") return route.fallback()
      const dir = url.searchParams.get("path") ?? ""
      const items = await page.evaluate((d) => {
        const w = window as unknown as {
          __deskfoxE2eMemfs?: {
            list(dir: string): Array<{ name: string; isDir: boolean; size: number; mtime: number }>
          }
        }
        return w.__deskfoxE2eMemfs?.list(d) ?? []
      }, dir)
      // memfs → FileNode 转换:目录路径用 dir + name 拼,absolute 用 /mock/workspace 根
      const nodes = items.map((it) => {
        const rel = dir ? `${dir}/${it.name}` : it.name
        return {
          name: it.name,
          path: rel,
          absolute: `/mock/workspace/${rel}`,
          type: it.isDir ? "directory" : "file",
          ignored: false,
        }
      })
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(nodes),
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

/** 注入特定文件 size 让 Tauri get_file_size mock 返指定值(测 large-file-preview 防护用)*/
export async function setMockFileSize(page: Page, path: string, size: number): Promise<void> {
  await page.evaluate(
    ({ p, s }) => {
      const w = window as unknown as {
        __deskfoxE2eOverride?: { setFileSize(p: string, n: number): void }
      }
      w.__deskfoxE2eOverride?.setFileSize(p, s)
    },
    { p: path, s: size },
  )
}

// ============== 扩展 base test:自动装 catch-all mock ==============

export const test = base.extend<{ mockedPage: Page }>({
  mockedPage: async ({ page }, use) => {
    await installServerMock(page)
    await use(page)
  },
})

export { expect }
