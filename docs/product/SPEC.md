# Agent Foundry Build Studio 需求文档 v2（基于 OpenCode 实现）

## 0) 目标重述（Deliverable）

Build Console 升级为 **Build Studio（桌面优先，后续移动端）**。核心体验类似 Gemini Build：
**左侧 Chat（vibe coding） + 右侧 Workspace（Preview/Code Tab）**，并在右上角提供 **Deploy to AF / Export Local / Copy Workspace** 三个关键动作。

---

## 1) 关键假设（<=5）

1. **桌面端优先**：先做 Desktop Studio（建议 Tauri），内置或自动拉起本地 OpenCode Server（Hono）作为 backend。
2. **共享 UI 代码**：Studio UI 用 Web 技术（React + Vite + Tailwind + shadcn），可同时被 Desktop（Tauri WebView）和 Mobile（WKWebView）复用。
3. **Preview 沙盒先“轻隔离”**：MVP 直接在本机目录中 spawn `pnpm run dev`（带权限提示/白名单）；Phase 2 再容器化/真正 sandbox。
4. **Copy = Fork Workspace**：复制工作区目录 + 生成新 workspaceId，并关联 parentWorkspaceId（可选：同时 fork session）。
5. **Deploy to AF**：MVP 走“build 产物上传 + metadata 注册 + feed/publish”最小链路，先不做复杂的版本治理/灰度。

---

## 2) Build Studio 产品需求文档（PRD v2）

### 2.1 IA / 布局（两栏 + 右上角动作）

**全局结构：两栏固定（可拖拽比例）**

- **左栏：Chat 区（交互式 vibe coding）**
  - streaming 输出
  - tool call / tool result timeline
  - 可切换 agent（plan/build）
  - 可插入 “选中文件/选中片段” 作为上下文

- **右栏：Workspace 区（Tab 切换）**
  - Tab A：**Preview**
    - 在“沙盒 dev server”中运行 `pnpm run dev`
    - 内嵌 WebView/iframe 展示 `http://localhost:<port>`
    - 显示 dev server 状态、端口、日志、重启按钮
  - Tab B：**Code**
    - 左侧：文件树（git-aware / ignore-aware）
    - 右侧：编辑器（Monaco/CodeMirror）
    - 支持多文件 Tab、diff view（Phase 2）

**右上角全局动作：**

- **Deploy to AF**
- **Export to Local**
- **Copy（Fork workspace）**

---

### 2.2 核心用户路径（P0）

#### Flow 1：Chat 驱动改代码 → Preview 自动更新

1. 用户在 Chat 描述需求
2. Agent 通过 tools 修改文件（write/edit/multiedit）
3. Code Tab 里文件自动刷新（watch / event）
4. Preview Tab 的 Vite HMR 自动刷新（dev server 常驻）

#### Flow 2：一键 Preview（沙盒运行）

- 第一次打开 Preview：
  - 若没安装依赖 → 提示 `pnpm install`（ask 许可）
  - 启动 `pnpm run dev -- --port <allocated>`（ask/allow by policy）
  - 展示状态：Starting / Ready / Error
  - 日志可折叠查看

#### Flow 3：Deploy to AF（最小发布闭环）

- 点击 Deploy：
  1. 停止 dev server（可选）
  2. 执行 `pnpm run build`
  3. 打包 dist + manifest（WebApp bundle）
  4. 上传到 AF Storage（signed url 优先）
  5. 调用 AF API：artifact.create / app.update / feed.publish
  6. 返回：artifactId、share link、（可选）deep link

#### Flow 4：Export to Local

- 打开系统文件选择器 → 导出 zip 或导出目录
- 默认排除：`node_modules/`, `dist/`, `.cache/`（可勾选包含）
- 输出：`workspace.zip` + `README-export.md`（记录 build/deploy 信息）

#### Flow 5：Copy（Fork Workspace）

- 选择新名字/路径（默认 `xxx-copy-<ts>`）
- 复制文件（排除 node_modules 可选）
- 新 workspace 继承：
  - `.agent-foundry/` 配置
  - OpenCode session 可选择是否 fork（MVP：fork 当前 session）
- Studio 自动切换到新 workspace（右上角 breadcrumb 显示 parent）

---

## 3) MVP 方案（先跑通）

### 3.1 组件与进程架构（Desktop）

**建议：Tauri Desktop + 内置本地 server + runner**

- **Studio UI（React）**：纯前端，两栏布局 + 编辑器 + preview
- **OpenCode Server（Hono）**：本地 `127.0.0.1:<port>`
  - 负责：agent runner、session/sqlite、tool registry、streaming（SSE/WS）
- **Workspace Runner（本地执行器）**
  - 负责：`pnpm install/dev/build` 的进程管理、端口分配、日志收集
  - 通过 OpenCode tools 暴露：`workspace.dev.start/stop/logs/status`

> MVP 的“沙盒”先是“受控本地进程”，靠 **权限询问 + allowlist + 审计** 控风险；Phase 2 再做容器隔离。

---

### 3.2 必须实现的工具（OpenCode tools 扩展）

建议以 plugin 形式提供（例如 `@agent-foundry/opencode-plugin`）：

#### Workspace / Dev Server

- `workspace.open`：打开/创建 workspace（选择目录）
- `workspace.dev.start({workspaceId}) -> {url, port}`
- `workspace.dev.stop({workspaceId})`
- `workspace.dev.logs({workspaceId, tail})`
- `workspace.run.script({workspaceId, script})`（白名单：install/build/test）

#### AF 发布链路（最小）

- `af.deploy.webapp({workspaceId, env}) -> {artifactId, shareUrl}`
  - 内部步骤：build → bundle → upload → register → publish
- `af.export.zip({workspaceId, dest}) -> {path}`
- `af.workspace.fork({workspaceId}) -> {newWorkspaceId}`

---

## 4) Phase 2/3 增强

### Phase 2（体验打磨）

- Code：多文件 tab、搜索、diff（展示 agent 修改）
- Chat：一键“应用改动 / 回滚改动”（把工具写入变成可撤销 patch）
- Preview：自动检测端口冲突、崩溃自动重启、性能面板（加载耗时）
- Deploy：版本号/变更日志、artifact 版本历史、回滚到上一个 deploy

### Phase 3（真正 sandbox + 移动端）

- Desktop：dev/build 迁移到 container sandbox（Docker/Podman）
- Mobile：两种模式
  1. **Remote Mode（推荐）**：手机只是 client，连到桌面/云端 OpenCode Server（符合 OpenCode client-server）
  2. **Lite Mode**：仅浏览 Code/Preview，不在手机本地跑 `pnpm dev`

---

## 5) 数据模型（建议新增 Workspace 概念）

OpenCode 的 Session 很强，但 Studio 需要把“工程目录”提升为一等公民：

```ts
type WorkspaceId = string; // ULID

interface Workspace {
  id: WorkspaceId
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
  parentWorkspaceId?: WorkspaceId

  // runtime
  devServer?: {
    status: 'stopped' | 'starting' | 'running' | 'error'
    port?: number
    url?: string
    pid?: number
    lastError?: string
  }
}
```

Session 仍然保留（并与 workspace 绑定）：

```ts
interface Session {
  id: string
  workspaceId: WorkspaceId
  agentId: 'plan' | 'build' | string
  // ...
  parentId?: string // fork session
}
```

---

## 6) API（Studio UI ↔ OpenCode Server）

保持 OpenCode 的 message streaming（SSE/WS），并补充 workspace endpoints（或以 tools 承载）。

**推荐：尽量都走 tool**（便于权限/审计/统一日志），UI 只需要：

- `POST /session/:id/message`（stream）
- `GET /event`（tool.executed / workspace.status）
- `GET /workspace/:id`（可选：纯读）

---

## 7) 安全与权限（MVP 可控）

- plan agent：默认 `bash` / `workspace.run.script` / `af.deploy.*` 全部 `ask`
- build agent：允许 file write/edit，但 `deploy/export` 仍建议 `ask`
- `workspace.run.script` 强制白名单：`pnpm install/dev/build/test`（其它命令需要显式确认）

---

## 8) 可观测与回滚

### 关键日志/指标

- dev server：启动耗时、崩溃次数、端口冲突次数
- agent：每次 tool call latency、失败率
- deploy：build 耗时、上传耗时、artifact 注册耗时、publish 成功率

### 回滚策略

- workspace fork 天然是回滚：Deploy 失败可 fork 修复再发
- deploy 记录 lastSuccessfulArtifactId（Phase 2 做一键回滚）

---

## 9) TODO Checklist（可直接贴 issue）

### MVP（两周内能跑通的最小集合）

- [ ] Studio UI：两栏布局 + Preview/Code Tab + 右上角 3 按钮
- [ ] Workspace 数据模型 + 最近打开列表
- [ ] Workspace Runner：start/stop/logs（spawn pnpm dev）
- [ ] OpenCode plugin：注册 `workspace.*` tools
- [ ] Code：文件树 + 单文件编辑（Monaco/CodeMirror）
- [ ] Preview：内嵌 dev url + 状态展示 + 一键重启
- [ ] Deploy：`pnpm build` + dist 打包 + AF upload/register/publish（先最小链路）
- [ ] Export：zip 导出（系统对话框）
- [ ] Copy：fork workspace（复制目录 + fork session）

### 基本测试

- [ ] 单测：workspace runner 状态机（starting/running/error）
- [ ] 集成：dev server 启动→写文件→HMR 生效
- [ ] e2e：deploy 成功返回 shareUrl；失败有可读错误