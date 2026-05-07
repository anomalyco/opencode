---
feat-id: e2e-mock-infrastructure
status: done
related: ./3-changelog.md
---

# 3-changelog — e2e 基础设施 mock 路径建立 + 5 个真实 e2e 跑通

## 起源

C 方案 v2 双清单的 View 清单门槛要"等 e2e 基础设施 setup"才生效。本笔实施 — 建立 e2e 基础设施使 View 清单门槛能真生效,逻辑闭环。

## 选定路径:Playwright `page.route` 拦截 mock(不依赖 sidecar)

3 选 1 中选 mock 路径:

| 方案 | 选 | 理由 |
|---|---|---|
| **A. webServer 启 opencode serve sidecar** | ✗ | setup 复杂(env / password / 数据库 / provider config),启动慢 ~10-20s |
| **B. 前端加 e2e mock mode `VITE_E2E_MOCK=1`** | ✗ | 需改前端代码大量分支 |
| **C. Playwright `page.route` 拦截 + 假响应** | ✓ | 不改前端 / 不依赖外部进程 / 跑得快 |

C 路径核心:Playwright 拦截所有 4096 端口请求,GET 返空数组 / POST 返 ok / health 返正常。前端 fetch 不再 hang,SolidJS 能 hydrate,UI render 起来。

## 改动清单

### 新文件 — `packages/app/e2e/fixtures.ts`(~50 行)

提供 `installServerMock(page)` helper + 扩展 base `test` 加 `mockedPage` fixture:
- 拦截 `**://${SERVER_HOST}:${SERVER_PORT}/**`(默认 `127.0.0.1:4096`)
- `/health` → `{ status: "ok", mock: true }`
- 其他 GET → `{ data: [], items: [], mock: true }`
- POST/PUT/DELETE → `{ ok: true, mock: true }`

测试用法:
```ts
import { test, expect } from "./fixtures"
test("...", async ({ mockedPage: page }) => {
  await page.goto("/")
  // ...
})
```

### 修改 — `e2e/smoke.spec.ts`

- 拆 2 个测试:baseline(无 mock 链路通)+ mock 路径(装 mock 后能 render)
- mock 路径实测 body 渲染 345 字符,UI 真出来:`No projects open / Open a project to get started / Getting started / OpenCode includes free models so you can start immediately. / ...`

### 新文件 — `e2e/i18n-sidebar.spec.ts`(3 测试)

证明 mock 路径能跑真 e2e + 验证 `i18n-history-drift-补全` feat 修的 23 key:
- **默认 locale (en):sidebar 空状态 i18n 渲染** — assert `No projects open` + `Open a project to get started`(对应 `sidebar.empty.title` / `description`,我们刚补全的 i18n key)
- **gettingStarted 文案** — assert `Getting started` + `free models`(对应 `sidebar.gettingStarted.*`)
- **0 fatal console error** — 严格断言全 mock 环境下无 SolidJS 渲染失败 / 未捕获异常

## 测试结果

```
$ bun run test:e2e
6 tests total / 5 passed / 1 skipped(上游 todo.spec.ts fixme)/ 0 fail
18.5s

unit suite:531 pass / 1 fail(kobalte 老坑无关)
typecheck:15/15 ✓
```

## 路径踩坑

### 坑 1:`networkidle` 永远不发生

首版用 `await page.waitForLoadState("networkidle", { timeout: 15_000 })` → 超时。前端 SSE / 持续 fetch 让网络永远不 idle。修:用 `domcontentloaded` + `waitForTimeout(2000)` 等 SolidJS hydrate。

### 坑 2:strict mode 多 match

`getByText("No projects open")` 匹配 2 个元素(sidebar nav + main content 都渲染了同样文字)→ strict mode violation。修:加 `.first()` 取第一个。

### 坑 3:i18n drift 补全的 e2e 实证

i18n drift fix 当时的 unit test 守门"key 存在",但**实际 UI 是不是显示出来**靠 unit 测不到。这一笔 e2e 终于覆盖到了 — `No projects open` 真的在用户眼前 visible。这是 unit + e2e 双层保护的真实价值。

## V2 双清单门槛进度

| 清单 | 门槛状态 |
|---|---|
| **Logic 清单** | ✅ 严格守门(行覆盖率 ≥ 80%)|
| **View 清单** | ✅ **基础设施已建,门槛可生效** — 后续 view 清单文件加 e2e 即可触发硬门槛 |

V2 双清单逻辑闭环完成。

## 后续(未来 feat,backlog)

| 项 | 内容 | 投入 |
|---|---|---|
| **dialog-settings.tsx 第 1 个 view e2e** | 进设置面板 → assert 版本牌"DeskFox / v..." | 中(需 sidebar → settings 触发路径) |
| **file-tabs.tsx 第 1 个 view e2e** | mock 文件树 + 点 .md → assert 右键菜单 4 项 | 高(mock 数据要包含 sample .md) |
| **i18n 切换 e2e** | 默认 en → 切 zh → assert 中文 | 中 |
| **CI 集成** | GitHub Actions 跑 e2e suite | 中 |
| **真 sidecar 路径(可选)** | 补 A 方案作为高级测试(测真后端联调)| 高 |

## 规模 / R 标记

- 规模:Medium(~190 行 / 3 文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:✓
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:本 feat 是测试基础设施,自然满足
