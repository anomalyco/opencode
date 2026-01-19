# 技术栈分析报告

**生成时间**: 2026-01-19
**扫描级别**: Exhaustive
**项目**: OpenCode Monorepo

## 📊 总体技术架构

| 类别         | 主要技术         | 版本信息           |
| ------------ | ---------------- | ------------------ |
| **包管理器** | Bun              | 1.3.5              |
| **构建系统** | Turbo            | 2.5.6              |
| **语言**     | TypeScript       | 5.8.2              |
| **框架**     | SolidJS          | 1.9.10             |
| **运行时**   | Node.js 22+      | Cloudflare Workers |
| **部署平台** | Cloudflare + SST | -                  |

---

## 📦 核心包技术栈

### 1. OpenCode 主应用 (`packages/opencode/`)

| 类别            | 技术                      | 版本          | 用途         |
| --------------- | ------------------------- | ------------- | ------------ |
| **AI框架**      | @ai-sdk                   | 最新          | 多模型AI集成 |
| **UI框架**      | SolidJS                   | catalog       | 前端UI       |
| **CLI工具**     | yargs                     | 18.0.0        | 命令行参数   |
| **进程管理**    | bun-pty                   | 0.4.4         | 伪终端       |
| **文件监控**    | chokidar                  | 4.0.3         | 文件变化监听 |
| **Diff工具**    | diff                      | catalog       | 代码差异比较 |
| **HTTP客户端**  | hono                      | catalog       | API客户端    |
| **数据验证**    | zod                       | catalog       | 类型验证     |
| **工具库**      | remeda                    | catalog       | 实用工具     |
| **MCP支持**     | @modelcontextprotocol/sdk | 1.25.2        | MCP协议支持  |
| **GitHub集成**  | @octokit/rest             | catalog       | GitHub API   |
| **Tree-sitter** | web-tree-sitter           | 0.25.10       | 代码解析     |
| **终端UI**      | @clack/prompts            | 1.0.0-alpha.1 | 命令行交互   |

**AI模型提供商支持**:

- OpenAI, Anthropic, Google, Azure
- Amazon Bedrock, Cohere, Mistral
- Groq, Perplexity, Cerebras, Deepinfra
- Vercel AI SDK, TogetherAI, XAI

### 2. 桌面应用 (`packages/desktop/`)

| 类别          | 技术                                                                                 | 版本         | 用途         |
| ------------- | ------------------------------------------------------------------------------------ | ------------ | ------------ |
| **桌面框架**  | Tauri                                                                                | 2            | 桌面应用框架 |
| **前端构建**  | Vite                                                                                 | catalog      | 开发服务器   |
| **UI组件**    | @opencode-ai/app                                                                     | workspace:\* | 应用UI       |
| **状态管理**  | @solid-primitives/storage                                                            | catalog      | 本地存储     |
| **Tauri API** | @tauri-apps/api                                                                      | ^2           | Tauri原生API |
| **插件**      | dialog, opener, os, notification, process, shell, store, updater, http, window-state | ~2           | 各种系统功能 |

### 3. Web网站 (`packages/web/`)

| 类别         | 技术                  | 版本    | 用途             |
| ------------ | --------------------- | ------- | ---------------- |
| **静态站点** | Astro                 | 5.7.13  | 静态网站生成     |
| **UI集成**   | @astrojs/solid-js     | 5.1.0   | SolidJS支持      |
| **云部署**   | @astrojs/cloudflare   | 12.6.3  | Cloudflare Pages |
| **文档主题** | @astrojs/starlight    | 0.34.3  | 文档站点         |
| **Markdown** | marked + marked-shiki | catalog | 渲染支持         |
| **代码高亮** | shiki                 | catalog | 语法高亮         |
| **日期处理** | luxon                 | catalog | 时间处理         |

### 4. 云端控制台 (`packages/console/`)

| 类别       | 技术                 | 版本          | 用途        |
| ---------- | -------------------- | ------------- | ----------- |
| **框架**   | SolidStart           | catalog       | 全栈SolidJS |
| **路由**   | @solidjs/router      | catalog       | 客户端路由  |
| **SSR**    | Nitro                | 3.0.1-alpha.1 | 服务端渲染  |
| **云部署** | Vite + Cloudflare    | -             | 边缘部署    |
| **认证**   | @openauthjs/openauth | catalog       | 身份验证    |
| **UI组件** | @kobalte/core        | catalog       | 无障碍组件  |
| **图表**   | chart.js             | 4.5.1         | 数据可视化  |
| **邮件**   | @jsx-email/render    | 1.1.1         | 邮件模板    |

### 5. UI组件库 (`packages/ui/`)

| 类别         | 技术              | 版本    | 用途         |
| ------------ | ----------------- | ------- | ------------ |
| **组件库**   | @kobalte/core     | catalog | 基础组件     |
| **样式**     | TailwindCSS       | 4.1.11  | 原子化CSS    |
| **渲染**     | vite-plugin-solid | catalog | Vite集成     |
| **Markdown** | marked + katex    | catalog | 数学公式支持 |
| **代码高亮** | shiki             | catalog | 语法高亮     |
| **虚拟列表** | virtua            | 0.42.3  | 列表优化     |
| **拖拽**     | solid-dnd         | -       | 拖拽功能     |
| **主题**     | 内置20+主题       | -       | 主题系统     |

### 6. 工具库 (`packages/util/`)

提供通用的工具函数和实用程序。

### 7. SDK (`packages/sdk/`)

| 类别        | 技术                  | 版本 | 用途    |
| ----------- | --------------------- | ---- | ------- |
| **API定义** | OpenAPI 3.1           | -    | API规范 |
| **SDK语言** | JavaScript/TypeScript | -    | SDK实现 |

### 8. Slack集成 (`packages/slack/`)

| 类别     | 技术             | 版本         | 用途          |
| -------- | ---------------- | ------------ | ------------- |
| **框架** | @slack/bolt      | ^3.17.1      | Slack应用框架 |
| **SDK**  | @opencode-ai/sdk | workspace:\* | 内部SDK       |

### 9. Serverless函数 (`packages/function/`)

| 类别       | 技术                      | 版本    | 用途           |
| ---------- | ------------------------- | ------- | -------------- |
| **框架**   | Hono                      | catalog | Web框架        |
| **认证**   | jose                      | 6.0.11  | JWT处理        |
| **GitHub** | @octokit/auth-app         | 8.0.1   | GitHub应用认证 |
| **类型**   | @cloudflare/workers-types | catalog | Cloudflare类型 |

---

## 🏗️ 架构模式

### 核心架构原则

1. **Monorepo管理**: 使用Turbo管理多包构建
2. **包管理器**: Bun + workspace协议
3. **类型系统**: TypeScript严格模式
4. **UI一致性**: 统一的UI组件库和主题系统
5. **AI集成**: 统一的AI SDK支持多模型
6. **部署策略**: 多平台部署（桌面、Web、云端）

### 技术决策亮点

- **前端框架选择**: SolidJS for performance
- **AI框架**: @ai-sdk for provider flexibility
- **桌面方案**: Tauri for lightweight desktop
- **静态站点**: Astro for docs and marketing
- **云端部署**: Cloudflare Workers for edge computing
- **Monorepo**: Turbo for efficient builds

---

## 📈 依赖管理

### 主要工作区依赖

```json
{
  "workspaces": ["packages/*", "packages/console/*", "packages/sdk/js", "packages/slack"]
}
```

### 核心目录结构

```
packages/
├── opencode/          # 主CLI应用
├── desktop/           # Tauri桌面应用
├── web/               # Astro静态网站
├── console/           # Cloudflare控制台
│   ├── app/          # 前端应用
│   ├── core/         # 核心功能
│   ├── function/     # Serverless函数
│   ├── mail/         # 邮件服务
│   └── resource/     # 资源管理
├── app/              # Web应用
├── enterprise/       # 企业功能
├── extensions/       # 编辑器扩展
├── plugin/           # VSCode插件
├── sdk/              # 开放SDK
├── ui/               # UI组件库
├── util/             # 工具库
├── slack/            # Slack集成
├── function/         # Serverless函数
└── identity/         # 身份资源
```

---

## 🔒 安全性

- **依赖扫描**: 使用trustedDependencies
- **类型安全**: TypeScript + Zod验证
- **认证**: @openauthjs/openauth, @octokit/auth-app
- **包管理**: Bun的安全特性
