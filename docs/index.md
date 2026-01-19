# OpenCode 项目文档索引

**生成时间**: 2026-01-19
**项目**: OpenCode Monorepo
**版本**: 1.1.13

---

## 📊 项目概览

**类型**: Monorepo (13个独立部分)
**主要技术**: TypeScript, SolidJS, Tauri, Astro, Cloudflare
**包管理器**: Bun 1.3.5
**构建系统**: Turbo 2.5.6

### 快速参考

- **主应用**: OpenCode CLI (packages/opencode)
- **桌面应用**: Tauri桌面客户端 (packages/desktop)
- **Web网站**: Astro静态站点 (packages/web)
- **云端控制台**: SST + Cloudflare (packages/console)
- **UI组件库**: 20+主题 (packages/ui)

---

## 📁 生成的文档

### 1. 技术栈分析

- **文件**: `technology-stack.md`
- **内容**: 完整的技术栈分析，包括各包使用的框架和库
- **涵盖**: AI SDK, SolidJS, Tauri, Astro, Cloudflare Workers

### 2. 架构模式

- **文件**: `architecture-patterns.md`
- **内容**: 系统架构设计模式，包括AI驱动、跨平台、Monorepo等
- **涵盖**: 数据流、集成架构、安全架构

### 3. API合约

- **文件**: `api-contracts.md`
- **内容**: OpenCode服务器API完整文档
- **涵盖**: 50+端点, Session管理, PTY, Provider配置

### 4. 源树分析

- **文件**: `source-tree-analysis.md`
- **内容**: 完整的目录结构分析
- **涵盖**: 关键入口点, 组件分布, 集成点

### 5. 开发指南

- **文件**: `development-guide.md`
- **内容**: 开发环境设置和最佳实践
- **涵盖**: 安装、开发命令、测试、部署

### 6. 现有文档清单

- **文件**: `existing-documentation-inventory.md`
- **内容**: 项目中已有的19个文档汇总
- **涵盖**: README、贡献指南、API文档

### 7. 用户上下文

- **文件**: `user-provided-context.md`
- **内容**: 工作流执行参数和重点区域
- **涵盖**: 扫描级别、项目类型、特殊考虑

---

## 🔗 文档链接

### 核心文档

- [项目概述](./project-overview.md) _(待生成)_
- [技术栈](./technology-stack.md) ✅
- [架构模式](./architecture-patterns.md) ✅
- [API合约](./api-contracts.md) ✅
- [源树分析](./source-tree-analysis.md) ✅
- [开发指南](./development-guide.md) ✅

### 开发文档

- [组件清单](./component-inventory.md) _(待生成)_
- [API文档](./api-contracts.md) ✅
- [数据模型](./data-models.md) _(不适用)_

### 部署文档

- [部署指南](./deployment-guide.md) _(待生成)_
- [CI/CD配置](./.github/workflows/)

### 现有文档

- [主README](../README.md)
- [贡献指南](../CONTRIBUTING.md)
- [代码风格](../STYLE_GUIDE.md)
- [代理配置](../AGENTS.md)

---

## 🚀 快速开始

### 新开发者

1. **阅读**: [开发指南](./development-guide.md)
2. **查看**: [技术栈](./technology-stack.md)
3. **了解**: [架构模式](./architecture-patterns.md)

### 使用AI辅助开发

1. **参考**: 此索引文档
2. **查看**: [API合约](./api-contracts.md)
3. **探索**: [源树分析](./source-tree-analysis.md)

### 贡献代码

1. **遵循**: [CONTRIBUTING.md](../CONTRIBUTING.md)
2. **使用**: [开发指南](./development-guide.md)
3. **参考**: [现有文档清单](./existing-documentation-inventory.md)

---

## 📦 包结构概览

| 包             | 用途       | 关键文件                         |
| -------------- | ---------- | -------------------------------- |
| **opencode**   | 主CLI应用  | `bin/opencode`, `src/index.ts`   |
| **desktop**    | 桌面应用   | `src-tauri/`, `vite.config.ts`   |
| **web**        | 静态网站   | `astro.config.mjs`, `src/pages/` |
| **console**    | 云端控制台 | `sst.config.ts`, `cloudflare/`   |
| **app**        | Web应用    | `src/app.tsx`, `src/pages/`      |
| **ui**         | UI组件库   | `src/components/`, `src/theme/`  |
| **sdk**        | SDK        | `openapi.json`, `js/src/`        |
| **util**       | 工具库     | `src/*.ts`                       |
| **plugin**     | VSCode插件 | `src/index.ts`                   |
| **extensions** | 编辑器扩展 | `zed/extension.toml`             |
| **slack**      | Slack集成  | `src/index.ts`                   |
| **function**   | Serverless | `src/api.ts`                     |
| **enterprise** | 企业功能   | `src/routes/`                    |

---

## 🎯 使用场景

### AI驱动的开发

1. **理解系统**: [架构模式](./architecture-patterns.md)
2. **查找API**: [API合约](./api-contracts.md)
3. **定位代码**: [源树分析](./source-tree-analysis.md)

### 添加新功能

1. **了解结构**: [源树分析](./source-tree-analysis.md)
2. **遵循规范**: [开发指南](./development-guide.md)
3. **参考现有**: [现有文档](./existing-documentation-inventory.md)

### 问题排查

1. **API问题**: [API合约](./api-contracts.md)
2. **构建问题**: [开发指南](./development-guide.md)
3. **架构问题**: [架构模式](./architecture-patterns.md)

---

## 📈 文档统计

- **生成文档**: 8个
- **现有文档**: 19个
- **总计**: 27个文档
- **扫描级别**: Exhaustive

---

## 🔄 文档更新

### 自动生成

此文档由 `document-project` 工作流自动生成。

### 手动更新

需要更新时，重新运行工作流：

```bash
# 使用Exhaustive扫描
# 工作流将检测变化并更新文档
```

### 文档质量

✅ **已完成**:

- 技术栈分析
- 架构模式
- API合约
- 源树分析
- 开发指南

🔄 **待生成**:

- 项目概述
- 组件清单
- 部署指南

---

## 📞 获取帮助

### 文档导航

- **查找特定内容**: 使用页面搜索
- **理解架构**: 从[架构模式](./architecture-patterns.md)开始
- **开始开发**: 从[开发指南](./development-guide.md)开始

### 相关资源

- **主仓库**: [GitHub](https://github.com/anomalyco/opencode)
- **问题反馈**: GitHub Issues
- **讨论**: GitHub Discussions
