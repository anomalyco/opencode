# OpenCode 桌面端无响应问题说明（2026-07-29）

## 1. 问题概述

- 现象：OpenCode 桌面端（Windows）在启动后进入首页会出现窗口“无响应”（UI 假死），用户需要手动导出日志或重启。
- 版本与环境：`OpenCode 1.18.7`，`Electron 42.3.3`，`Windows x64`。
- 影响范围：影响 Desktop Renderer 主线程交互，Sidecar/Server 本身可继续提供服务。

## 2. 日志证据（可复核）

### 2.1 Debug 包元信息

来源：`opencode-debug-20260729T072406.zip`（用户导出日志包）

关键信息：

- `manifest.generated`: `2026-07-29T07:24:06.052Z`
- `manifest.version`: `1.18.7`
- `manifest.platform`: `win32`
- `manifest.currentRun`: `...\\logs\\20260729T072304`

### 2.2 Renderer 无响应栈

`desktop/20260729T072304/window.log` 显示连续无响应采样，热点栈一致：

- `renderer unresponsive`
- `RegExp.exec`
- `u.inlineTokens`
- `u.lex`
- `D.parse`
- `preloadMarkdown (oc://renderer/assets/main-Bn6buCyp.js:127935:58)`

同类事件在以下运行周期重复出现：

- `desktop/20260729T071645/window.log`
- `desktop/20260729T072304/window.log`

### 2.3 主进程与 Sidecar 状态

`desktop/20260729T072304/main.log`：

- `server ready { url: 'http://127.0.0.1:58796' }`
- 存在 `net::ERR_CONNECTION_TIMED_OUT`（自动更新请求）

结论：自动更新网络超时并非本次 UI 假死主因；主因位于 Renderer Markdown 预解析路径。

## 3. 根因分析

### 3.1 代码路径

首页会对最近会话进行 Markdown 预热：

- `packages/app/src/pages/home/home-sessions-controller.tsx`
- 在会话预取过程中调用 `preloadMarkdown(part.text, part.id, marked)`。

预热函数位于：

- `packages/session-ui/src/components/markdown-cache.tsx`
- 之前会对文本块直接执行 `parser.parse(block.src)`。

### 3.2 为什么会卡死

- `marked` 在部分超大/异常文本（超长单行、大体量连续文本）上会在词法扫描阶段占用大量 CPU。
- 当前逻辑在首页预热时批量解析多个会话文本片段，属于主线程工作；一旦命中大文本+批量预热，UI 事件循环被长期占用，触发 Electron `unresponsive`。

### 3.3 数据侧佐证

从本机 `opencode.db` 统计（`part` 表 `type='text'`）：

- 文本片段总数：`3615`
- 最大文本长度：`1,653,459` 字符
- 最近活跃会话中存在高密度文本片段（单会话 `801` 个 text part）

该数据规模足以触发预热阶段的主线程阻塞。

## 4. 修复方案

### 4.1 修复目标

- 保护主线程：避免对可疑大文本进行昂贵 Markdown 解析。
- 控制预热规模：预热是优化而非功能正确性依赖，缓存预算满后应停止扩张。
- 保留可用性：遇到超限文本时降级为安全 fallback 渲染，不阻断页面可读。

### 4.2 已实现改动

#### A. 解析前安全阈值（大小/行数/超长行）

文件：`packages/session-ui/src/components/markdown-cache.tsx`

- 新增 `canParseMarkdown(text)`：
  - 总长度阈值：`200_000`
  - 换行数阈值：`4_000`
  - 单行超长阈值：`> 8_000` 字符
- `preloadMarkdown(...)` 在解析前调用 `canParseMarkdown`，超限直接跳过。
- 增加预加载输入总长度限制：`40_000`（超限直接不做预热）。

#### B. 预热预算控制

文件：`packages/session-ui/src/components/markdown-cache.tsx`

- 新增 `maxPreloadEntries = 120`。
- 当缓存中不存在该 key 且 `cache.size >= 120` 时，停止新增预热条目。
- 说明：运行时正常渲染仍可按需生成，不影响核心功能，仅限制后台预热扩张。

#### C. 渲染链路降级保护

文件：`packages/session-ui/src/components/markdown.tsx`

- 原逻辑：始终 `marked.parse(block.src)`。
- 新逻辑：
  - 可解析：走 `marked.parse + sanitizeMarkdown`
  - 不可解析：走 `fallback(block.src)`

目标：即使异常文本进入渲染链路，也不再长时间阻塞主线程。

#### D. 新增回归测试

文件：`packages/session-ui/src/components/markdown-preload.test.ts`

新增测试：

- `skips preloading oversized markdown`
- `skips preloading markdown with very long lines`
- `stops background preloading when preload budget is full`

## 5. 验证结果

### 5.1 代码验证

在 `packages/session-ui` 下执行：

- `bun test src/components/markdown-preload.test.ts` ✅ 通过（4/4）
- `bun run test` ✅ 通过（79/79）
- `bun typecheck` ✅ 通过

### 5.2 本地启动冒烟

按仓库建议命令验证：

- 后端：`packages/opencode`
  - `bun run --conditions=browser ./src/index.ts serve --port 4096`
  - 通过 HTTP 检测 `http://127.0.0.1:4096` 返回 `200`
- 前端：`packages/app`
  - `bun dev -- --port 4444`
  - Vite 启动成功，`http://localhost:4444/` 返回 `200`

## 6. 兼容性与风险

- 行为变化仅发生在“超限文本 + 预热/渲染”场景。
- 正常规模 Markdown 不受影响。
- 超限文本会降级为 fallback HTML（保可读、保响应性），这是有意的稳定性优先策略。

## 7. PR 评审建议（给 Admin）

- 这是一次稳定性修复（`fix`），目标是避免 Desktop Renderer 无响应。
- 证据链完整：日志栈 -> 代码路径 -> 数据规模 -> 修复与回归测试。
- 修复具备保守性：仅在风险输入触发降级，未修改协议与数据模型。
- 建议合入后关注：
  - 无响应告警（window unresponsive）是否下降
  - 超限 fallback 触发比例（可后续补指标）

## 8. 后续可选优化

- 将 `marked.parse` 迁移/拆分到 Worker 路径，进一步隔离主线程。
- 预热任务分片并在 `requestIdleCallback` 中调度，降低突发 CPU 峰值。
- 为 `canParseMarkdown` 增加可配置阈值（便于线上调优）。

