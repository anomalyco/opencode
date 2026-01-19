# 开发指南

**生成时间**: 2026-01-19
**扫描级别**: Exhaustive

## 🚀 快速开始

### 环境要求

- **Node.js**: >= 22 (Cloudflare Workers要求)
- **Bun**: 1.3.5 (包管理器)
- **TypeScript**: 5.8.2
- **Git**: 最新版本

### 安装步骤

```bash
# 1. 克隆项目
git clone https://github.com/anomalyco/opencode.git
cd opencode

# 2. 安装依赖
bun install

# 3. 安装 husky 钩子
bun prepare

# 4. 运行类型检查
bun typecheck
```

---

## 🛠️ 开发命令

### 主应用开发

```bash
# 启动开发服务器 (默认端口 4096)
bun dev

# 构建生产版本
bun build

# 运行测试
bun test

# 类型检查
bun typecheck

# 代码格式化
bun run format

# 代码检查
bun run lint
```

### 桌面应用

```bash
cd packages/desktop

# 开发模式 (Vite热重载)
bun dev

# 生产构建
bun build

# Tauri 命令
bun tauri build
bun tauri dev
```

### Web网站 (Astro)

```bash
cd packages/web

# 开发服务器
bun dev

# 构建静态站点
bun build

# 预览构建
bun preview
```

### 云端控制台 (SST)

```bash
cd packages/console/app

# 本地开发
bun dev

# 远程开发 (连接auth.dev.opencode.ai)
bun run dev:remote

# 构建并部署
bun build

# SST Shell
bun sst shell
```

### 所有包

```bash
# Turbo 构建所有包
bun turbo build

# Turbo 类型检查
bun turbo typecheck
```

---

## 📦 包管理

### Monorepo结构

```
opencode/
├── package.json          # 根配置，工作区定义
├── bun.lockb             # Bun锁定文件
├── turbo.json            # Turbo构建配置
├── packages/
│   ├── opencode/        # 主CLI应用
│   ├── desktop/         # 桌面应用
│   ├── web/             # 静态网站
│   ├── console/         # 云端控制台
│   ├── app/             # Web应用
│   ├── enterprise/      # 企业功能
│   ├── ui/              # UI组件库
│   ├── util/            # 工具库
│   ├── sdk/             # SDK
│   ├── plugin/          # VSCode插件
│   ├── extensions/      # 编辑器扩展
│   ├── slack/           # Slack集成
│   ├── function/        # Serverless函数
│   └── identity/        # 身份资源
```

### 工作区依赖

使用 `workspace:*` 协议引用本地包：

```json
{
  "dependencies": {
    "@opencode-ai/ui": "workspace:*",
    "@opencode-ai/sdk": "workspace:*",
    "@opencode-ai/util": "workspace:*"
  }
}
```

### 版本管理

所有包共享相同版本 (1.1.13)，在根目录 `package.json` 中定义。

---

## 🎨 开发规范

### 代码风格

项目使用 **Prettier** 进行代码格式化：

```json
// .prettierrc
{
  "semi": false,
  "printWidth": 120
}
```

### TypeScript配置

- **严格模式**: 启用所有严格检查
- **目标**: ES2022
- **模块**: ESNext
- **路径别名**: 使用 `@/` 前缀

```json
// tsconfig.json 路径示例
{
  "paths": {
    "@/*": ["./src/*"]
  }
}
```

### Git提交规范

项目使用 **Husky** 和 **commitlint**：

```bash
# 提交格式
<type>(<scope>): <subject>

# 示例
feat(server): add new PTY endpoint
fix(tool): resolve read tool error
docs(readme): update installation guide
```

### 文件组织

```
src/
├── components/     # UI组件
├── context/        # React Context
├── hooks/          # 自定义Hooks
├── utils/          # 工具函数
├── types/          # 类型定义
└── index.ts        # 入口文件
```

---

## 🧪 测试

### 测试命令

```bash
# 运行所有测试
bun test

# 运行特定包测试
bun test --filter=opencode

# 带覆盖率
bun test --coverage
```

### 测试文件

- **位置**: `*.test.ts` 或 `*.spec.ts`
- **框架**: Bun test
- **覆盖**: 单元测试、集成测试

---

## 🔧 构建系统

### Turbo管道

```json
// turbo.json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {},
    "opencode#test": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

### 构建顺序

1. **工具依赖** → packages/util, packages/ui
2. **核心依赖** → packages/sdk
3. **应用逻辑** → packages/opencode, packages/app
4. **平台适配** → packages/desktop, packages/web, packages/console

---

## 🚢 部署

### 环境配置

```bash
# Cloudflare Pages (web)
npm run build

# Cloudflare Workers (console)
bun build

# 桌面应用 (Tauri)
bun tauri build

# 发布到npm (sdk)
npm publish
```

### 环境变量

```bash
# 示例 .env
OPENAI_API_KEY=sk-...
GITHUB_CLIENT_ID=...
STRIPE_SECRET_KEY=...
```

### 部署平台

| 包           | 平台               | 部署方式         |
| ------------ | ------------------ | ---------------- |
| **web**      | Cloudflare Pages   | git push         |
| **console**  | Cloudflare Workers | `bun sst deploy` |
| **desktop**  | GitHub Releases    | Tauri构建        |
| **opencode** | npm + GitHub       | 手动发布         |

---

## 📚 学习资源

### 关键文件

- **README.md**: 项目主文档
- **AGENTS.md**: AI代理配置
- **CONTRIBUTING.md**: 贡献指南
- **STYLE_GUIDE.md**: 代码风格指南
- **package.json**: 依赖和脚本

### 架构文档

- **docs/**: 本文档档
- **specs/**: 设计规格
- **packages/\*/README.md**: 各包文档

---

## 🐛 调试技巧

### 本地调试

```bash
# 启用详细日志
DEBUG=* bun dev

# 调试特定模块
DEBUG=server,bun run dev
```

### 测试特定功能

```bash
# 测试工具系统
bun test packages/opencode/src/tool

# 测试会话管理
bun test packages/opencode/src/session
```

### 检查类型

```bash
# 严格类型检查
bun typecheck

# 生成类型定义
bun run generate-types
```

---

## 🔐 安全考虑

### 依赖安全

- 使用 `trustedDependencies` 限制敏感依赖
- 定期更新依赖版本
- 使用 `bun audit` 检查漏洞

### 代码安全

- **认证**: OAuth + JWT
- **授权**: 基于角色的访问控制
- **数据**: 加密存储

---

## 🤝 贡献指南

1. **Fork** 项目
2. **创建** 功能分支
3. **提交** 更改
4. **推送** 到分支
5. **创建** Pull Request

### 提交前检查

```bash
# 类型检查
bun typecheck

# 代码格式化
bun format

# 运行测试
bun test

# 构建验证
bun build
```

---

## 📞 支持

- **Issue**: GitHub Issues
- **讨论**: GitHub Discussions
- **文档**: 项目wiki
