# 源树分析报告

**生成时间**: 2026-01-19
**扫描级别**: Exhaustive
**项目**: OpenCode Monorepo

## 📁 项目根目录结构

```
G:\proj\opencode\
├── _bmad\                      # BMad配置和工具
│   ├── _config\                # 配置文件
│   ├── bmm\                    # BMM模块
│   │   ├── agents\             # 代理定义
│   │   ├── data\               # 数据文件
│   │   ├── teams\              # 团队配置
│   │   ├── testarch\           # 测试架构
│   │   ├── workflows\          # 工作流
│   │   └── config.yaml         # BMM配置
│   └── core\                   # 核心资源
│       ├── agents\             # 核心代理
│       ├── resources\          # 资源文件
│       ├── tasks\              # 任务定义
│       ├── workflows\          # 核心工作流
│       └── config.yaml         # 核心配置
├── .github\                    # GitHub配置
│   ├── workflows\              # GitHub Actions
│   └── pull_request_template.md
├── .vscode\                    # VSCode配置
├── docs\                       # 项目文档 (当前输出目录)
├── github\                     # GitHub应用代码
├── infra\                      # 基础设施代码
│   ├── app.ts                  # SST应用配置
│   ├── console.ts              # 控制台基础设施
│   ├── enterprise.ts           # 企业基础设施
│   ├── secret.ts               # 密钥管理
│   └── stage.ts                # 阶段配置
├── logs\                       # 日志文件
├── nix\                        # Nix配置
├── patches\                    # 依赖补丁
├── script\                     # 脚本工具
├── sdks\                       # SDK开发
├── specs\                      # 规格文档
└── packages\                   # 核心包目录 ⭐
```

---

## 📦 核心包结构 (packages/)

```
packages/
├── app/                       # ⭐ 主Web应用 (SolidJS)
│   ├── src/
│   │   ├── components/        # React/Solid组件
│   │   │   ├── session/       # Session相关组件
│   │   │   ├── prompt-input.tsx
│   │   │   ├── file-tree.tsx
│   │   │   ├── dialog-*.tsx   # 各种对话框
│   │   │   └── terminal.tsx
│   │   ├── context/           # React Context
│   │   │   ├── terminal.tsx
│   │   │   ├── sync.tsx
│   │   │   ├── platform.tsx
│   │   │   └── ...10个context
│   │   ├── pages/             # 页面组件
│   │   │   ├── home.tsx
│   │   │   ├── session.tsx
│   │   │   ├── layout.tsx
│   │   │   └── ...4个页面
│   │   ├── entry.tsx          # 应用入口
│   │   └── app.tsx            # 根组件
│   └── README.md
│
├── console/                   # ⭐ 云端控制台 (SST + SolidStart)
│   ├── app/                   # 控制台前端
│   │   └── src/               # 前端代码
│   ├── core/                  # 核心功能
│   ├── function/              # Serverless函数
│   ├── mail/                  # 邮件服务
│   ├── resource/              # 资源管理
│   └── README.md
│
├── desktop/                   # ⭐ 桌面应用 (Tauri + SolidJS)
│   ├── src/
│   │   ├── src-tauri/         # Tauri原生代码 (Rust)
│   │   │   ├── src/
│   │   │   │   ├── main.rs
│   │   │   │   ├── lib.rs
│   │   │   │   ├── cli.rs
│   │   │   │   ├── window_customizer.rs
│   │   │   ├── icons/         # 应用图标
│   │   │   ├── tauri.conf.json
│   │   │   └── release/
│   │   └── components/        # Solid组件
│   ├── vite.config.ts
│   ├── README.md
│   └── package.json
│
├── docs/                      # 文档包
│   └── README.md
│
├── enterprise/                # ⭐ 企业功能
│   ├── src/
│   │   ├── routes/            # 路由组件
│   │   └── test/              # 测试
│   └── README.md
│
├── extensions/                # ⭐ 编辑器扩展
│   └── zed/                   # Zed编辑器扩展
│       ├── icons/
│       ├── extension.toml
│       └── LICENSE
│
├── function/                  # ⭐ Serverless函数
│   └── src/
│       └── api.ts             # Cloudflare Worker API
│
├── identity/                  # 身份资源
│   ├── mark-*.png             # 应用图标
│   └── mark.svg
│
├── opencode/                  # ⭐ 主应用 (CLI + 核心逻辑)
│   ├── bin/
│   │   └── opencode           # CLI入口
│   ├── src/
│   │   ├── acp/               # ACP协议
│   │   ├── agent/             # AI代理
│   │   ├── auth/              # 认证
│   │   ├── bus/               # 事件总线
│   │   ├── cli/               # CLI命令
│   │   ├── command/           # 命令管理
│   │   ├── config/            # 配置管理
│   │   ├── env/               # 环境变量
│   │   ├── file/              # 文件操作
│   │   ├── flag/              # 标志管理
│   │   ├── format/            # 代码格式化
│   │   ├── global/            # 全局状态
│   │   ├── id/                # ID生成
│   │   ├── ide/               # IDE集成
│   │   ├── installation/      # 安装管理
│   │   ├── lsp/               # LSP客户端
│   │   ├── mcp/               # MCP协议
│   │   ├── patch/             # 补丁管理
│   │   ├── plugin/            # 插件系统
│   │   ├── project/           # 项目管理
│   │   ├── provider/          # AI提供商
│   │   ├── pty/               # 伪终端
│   │   ├── server/            # HTTP服务器 ⭐
│   │   │   ├── server.ts      # 主服务器
│   │   │   ├── tui.ts         # TUI路由
│   │   │   ├── project.ts     # 项目路由
│   │   │   ├── question.ts    # 问答路由
│   │   │   ├── mdns.ts        # mDNS发现
│   │   │   ├── error.ts       # 错误处理
│   │   │   └── tui.ts         # TUI路由
│   │   ├── session/           # 会话管理 ⭐
│   │   │   ├── index.ts       # 主入口
│   │   │   ├── llm.ts         # LLM交互
│   │   │   ├── message.ts     # 消息处理
│   │   │   ├── message-v2.ts  # 消息V2
│   │   │   ├── prompt.ts      # 提示处理
│   │   │   ├── processor.ts   # 消息处理
│   │   │   ├── summary.ts     # 总结压缩
│   │   │   ├── compaction.ts  # 内容压缩
│   │   │   ├── status.ts      # 状态管理
│   │   │   ├── retry.ts       # 重试逻辑
│   │   │   ├── revert.ts      # 回滚管理
│   │   │   ├── todo.ts        # 待办管理
│   │   │   └── ...其他会话功能
│   │   ├── share/             # 分享功能
│   │   ├── shell/             # Shell管理
│   │   ├── skill/             # 技能系统
│   │   ├── snapshot/          # 快照管理
│   │   ├── storage/           # 存储管理
│   │   ├── tool/              # 工具系统 ⭐
│   │   │   ├── index.ts       # 工具主入口
│   │   │   ├── registry.ts    # 工具注册表
│   │   │   ├── tool.ts        # 工具接口
│   │   │   ├── read.ts        # 读取工具
│   │   │   ├── write.ts       # 写入工具
│   │   │   ├── edit.ts        # 编辑工具
│   │   │   ├── glob.ts        # 文件搜索
│   │   │   ├── grep.ts        # 文本搜索
│   │   │   ├── bash.ts        # Bash执行
│   │   │   ├── task.ts        # 任务工具
│   │   │   ├── todo.ts        # 待办工具
│   │   │   ├── skill.ts       # 技能工具
│   │   │   ├── lsp.ts         # LSP工具
│   │   │   ├── websearch.ts   # 网页搜索
│   │   │   ├── webfetch.ts    # 网页抓取
│   │   │   ├── codesearch.ts  # 代码搜索
│   │   │   ├── question.ts    # 问答工具
│   │   │   ├── patch.ts       # 补丁工具
│   │   │   ├── batch.ts       # 批量处理
│   │   │   ├── multiedit.ts   # 多编辑
│   │   │   ├── external-directory.ts
│   │   │   ├── invalid.ts
│   │   │   └── truncation.ts  # 内容截断
│   │   ├── util/              # 工具函数 ⭐
│   │   │   ├── archive.ts     # 归档
│   │   │   ├── context.ts     # 上下文
│   │   │   ├── color.ts       # 颜色处理
│   │   │   ├── defer.ts       # 延迟执行
│   │   │   ├── eventloop.ts   # 事件循环
│   │   │   ├── fn.ts          # 函数工具
│   │   │   ├── iife.ts        # IIFE
│   │   │   ├── keybind.ts     # 快捷键
│   │   │   ├── locale.ts      # 本地化
│   │   │   ├── lock.ts        # 锁机制
│   │   │   ├── log.ts         # 日志
│   │   │   ├── queue.ts       # 队列
│   │   │   ├── scrap.ts       # 抓取
│   │   │   ├── signal.ts      # 信号
│   │   │   ├── timeout.ts     # 超时
│   │   │   ├── token.ts       # Token计算
│   │   │   ├── wildchar.ts    # 通配符
│   │   │   ├── filesystem.ts  # 文件系统
│   │   │   ├── lazy.ts        # 延迟加载
│   │   │   └── rpc.ts         # RPC
│   │   ├── worktree/          # Git Worktree
│   │   ├── config/
│   │   ├── file/
│   │   └── ...其他模块
│   ├── script/
│   │   ├── build.ts           # 构建脚本
│   │   └── ...其他脚本
│   └── package.json
│
├── plugin/                    # ⭐ VSCode插件
│   ├── src/
│   │   ├── example.ts
│   │   ├── shell.ts
│   │   ├── tool.ts
│   │   └── index.ts
│   └── package.json
│
├── script/                    # ⭐ 脚本包
│   ├── src/
│   │   └── index.ts
│   └── package.json
│
├── sdk/                       # ⭐ SDK包
│   ├── js/
│   │   ├── src/
│   │   │   ├── v2/
│   │   │   │   ├── server.ts
│   │   │   │   ├── gen/
│   │   │   │   │   ├── types.gen.ts
│   │   │   │   │   └── sdk.gen.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   └── tsconfig.json
│   └── openapi.json
│
├── slack/                     # ⭐ Slack集成
│   ├── src/
│   │   └── index.ts
│   └── package.json
│
├── tauri/                     # ⭐ Tauri支持
│   └── (移动到desktop)
│
├── ui/                        # ⭐ UI组件库
│   ├── src/
│   │   ├── components/        # UI组件 ⭐
│   │   │   ├── provider-icons/
│   │   │   ├── file-icons/
│   │   │   ├── dialogs/
│   │   │   ├── forms/
│   │   │   ├── layout/
│   │   │   ├── navigation/
│   │   │   └── display/
│   │   ├── hooks/             # React Hooks
│   │   ├── context/           # Context
│   │   ├── theme/             # 主题系统 ⭐
│   │   │   ├── index.ts
│   │   │   ├── context.tsx
│   │   │   ├── loader.ts
│   │   │   ├── resolve.ts
│   │   │   ├── color.ts
│   │   │   ├── types.ts
│   │   │   ├── themes/
│   │   │   │   ├── vesper.json
│   │   │   │   ├── tokyonight.json
│   │   │   │   ├── nord.json
│   │   │   │   ├── dracula.json
│   │   │   │   └── ...15个主题
│   │   │   └── default-themes.ts
│   │   ├── styles/            # 样式
│   │   │   ├── index.css
│   │   │   └── tailwind/
│   │   ├── assets/            # 资源
│   │   │   ├── fonts/
│   │   │   └── audio/
│   │   └── ...
│   └── package.json
│
├── util/                      # ⭐ 工具库
│   ├── src/
│   │   ├── binary.ts
│   │   ├── encode.ts
│   │   ├── error.ts
│   │   ├── fn.ts
│   │   ├── iife.ts
│   │   ├── identifier.ts
│   │   ├── lazy.ts
│   │   ├── path.ts
│   │   └── retry.ts
│   └── package.json
│
└── web/                       # ⭐ 静态网站 (Astro)
    ├── src/
    │   ├── pages/             # Astro页面
    │   │   └── [...slug].md.ts
    │   ├── styles/            # 样式
    │   └── types/             # 类型定义
    └── package.json
```

---

## 🔑 关键入口点

### CLI入口

```bash
packages/opencode/bin/opencode
```

### 开发服务器

```bash
# OpenCode主应用
bun dev

# 桌面应用
bun run --cwd packages/desktop dev

# Web网站
bun run --cwd packages/web dev

# 控制台
bun run --cwd packages/console/app dev
```

### 构建入口

```bash
# 主应用构建
bun run --cwd packages/opencode build

# 桌面应用构建
bun run --cwd packages/desktop build

# 所有包构建
bun turbo build
```

---

## 📊 目录统计

| 目录                      | 主要文件数 | 用途         |
| ------------------------- | ---------- | ------------ |
| **packages/opencode/src** | 150+       | 核心应用逻辑 |
| **packages/app/src**      | 50+        | Web应用UI    |
| **packages/ui/src**       | 100+       | UI组件库     |
| **packages/console**      | 30+        | 云端控制台   |
| **packages/desktop/src**  | 20+        | 桌面应用     |
| **packages/util/src**     | 10         | 工具函数     |
| **packages/sdk**          | 15         | SDK代码      |
| **根目录配置**            | 50+        | 配置和脚本   |

---

## 🎯 架构关键点

### 1. 核心模块划分

- **工具系统** (tool/): 25+工具实现
- **会话管理** (session/): 15+会话功能
- **服务器** (server/): 6个主要路由模块
- **文件操作** (file/): 完整的文件系统抽象

### 2. UI组件库

- **20+预设主题**
- **丰富的组件目录**
- **Kobalte核心组件**
- **TailwindCSS样式**

### 3. 多平台支持

- **CLI**: packages/opencode/bin/opencode
- **桌面**: packages/desktop (Tauri)
- **Web**: packages/web (Astro)
- **云端**: packages/console (SST)
- **扩展**: packages/plugin, packages/extensions

### 4. 外部集成

- **GitHub**: @octokit/rest
- **Slack**: @slack/bolt
- **AI**: @ai-sdk/\* (15+提供商)
- **编辑器**: LSP, MCP协议

---

## 🔗 集成点

### 内部集成

```
packages/opencode → packages/ui (UI组件)
packages/opencode → packages/util (工具函数)
packages/opencode → packages/sdk (SDK)
packages/desktop → packages/app (应用UI)
packages/desktop → packages/ui (主题)
packages/console → packages/opencode (核心)
```

### 外部集成

```
packages/opencode → GitHub API
packages/opencode → AI Providers (15+)
packages/function → Cloudflare Workers
packages/slack → Slack API
```
