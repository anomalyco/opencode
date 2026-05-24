# DeskFox e2e 测试现状

> 状态:**第 1 期 baseline 已建(2026-05-07)** · 架子可用,业务测试待 opencode server 集成

## 当前能力

| 能力 | 状态 |
|---|---|
| Playwright 配置(`playwright.config.ts`)| ✓ 上游已建,fork 复用 |
| vite dev server 启动(端口 3000) | ✓ |
| Chromium headless 加载 | ✓ |
| smoke baseline 测试 | ✓ `smoke.spec.ts`(只测链路通)|
| 业务逻辑测试 | ✗ 待解决"无 opencode sidecar"问题 |

## 怎么跑

```bash
# 跑全部 e2e
bun run --cwd packages/app test:e2e

# 跑指定文件
bun run --cwd packages/app test:e2e smoke.spec.ts

# 带 GUI 调试模式
bun run --cwd packages/app test:e2e:ui

# 看 HTML 报告
bun run --cwd packages/app test:e2e:report
```

首次跑要先装 chromium 二进制:
```bash
cd packages/app && bunx playwright install chromium
```

## 现在测不了什么(为什么 baseline 之外没有)

DeskFox 前端启动后会立刻 fetch `127.0.0.1:4096`(opencode server)。当前 e2e setup 只启 vite dev server,**没启 opencode server**。后果:

- 前端初始化卡住 → body 为空
- 任何 UI 元素都 render 不出来 → 无法 assert 文件树 / 设置面板 / 右键菜单

`smoke.spec.ts` 因此**故意只 assert 链路通 + HTML 文档存在**,不 assert 任何 UI 内容。

## 后续接入路径(独立 backlog)

要让 e2e 能测真实业务逻辑,需选一条路:

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. webServer 同时启 opencode server** | 最贴近真实跑通 | 配置复杂,启动慢,端口冲突风险 |
| **B. 前端加 e2e mock mode**(`VITE_E2E_MOCK=1`)| 不依赖后端,快 | 需要维护 mock 数据,可能掩盖真实 bug |
| **C. 录制 fixture 做 server replay** | 真实数据,可控 | 录制 / 维护成本 |

推荐 **B + 选择性场景用 A**:
- 大部分 UI 测试(右键菜单 / 设置面板 / i18n 切换)走 mock,跑得快
- 涉及"前后端联调"才用真 server(少量场景)

## 上游 `todo.spec.ts`

是上游 anomalyco/opencode 留下的占位 fixme,**fork 不动**(避免 sync 冲突)。本次新加的测试文件命名以 `smoke.spec.ts` / `<feature>.spec.ts` 形式,与上游不重叠。

## 测试金字塔提示

按 R5 决策 3 (`docs/governance/自动化测试规范.md`),全仓 70% unit / 20% integration / 10% e2e。
e2e 不该堆数量 — 用户级关键路径 ~10 个就够。**单测覆盖一个变量空间,e2e 只跑一条路径**。
