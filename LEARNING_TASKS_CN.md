# OpenCode 学习任务清单

> 💡 这是一个循序渐进的学习计划,建议按阶段完成。每完成一个任务就打勾 ✅

---

## 📋 阶段1: 基础准备 (预计1-2周)

### TypeScript基础
- [ ] 学习基本类型 (string, number, boolean, any, unknown)
- [ ] 理解interface和type的区别
- [ ] 掌握泛型(Generics)基础
- [ ] 学习async/await和Promise
- [ ] 练习: 写5个小型TS程序

### Bun运行时
- [ ] 安装Bun: `curl -fsSL https://bun.sh/install | bash`
- [ ] 理解bun.lock和bunfig.toml
- [ ] 学习bun命令: install, run, dev, build
- [ ] 创建一个简单的Bun项目测试

### Git版本控制
- [ ] 掌握基本命令: clone, add, commit, push, pull
- [ ] 理解分支(branch)和合并(merge)
- [ ] 练习: 创建分支并提交代码

**难度**: ⭐⭐☆☆☆

---

## 📋 阶段2: 环境搭建 (预计3-5天)

### 项目设置
- [ ] 克隆OpenCode仓库
  ```bash
  git clone https://github.com/anomalyco/opencode.git
  cd opencode
  ```
- [ ] 安装所有依赖: `bun install`
- [ ] 检查依赖是否安装成功

### 运行项目
- [ ] 启动开发服务器:
  ```bash
  cd packages/opencode
  bun dev
  ```
- [ ] 测试终端界面是否正常启动
- [ ] 尝试与AI对话(需要配置API key)

### 开发工具
- [ ] 安装VS Code
- [ ] 安装TypeScript插件
- [ ] 配置调试环境(launch.json)
- [ ] 成功打断点并调试

**难度**: ⭐⭐⭐☆☆

---

## 📋 阶段3: 核心架构理解 (预计2-3周)

### Week 1: 服务器和路由
- [ ] 阅读 `packages/opencode/src/index.ts` (入口文件)
- [ ] 理解Yargs CLI框架的使用
- [ ] 阅读 `src/server/server.ts` (服务器启动)
- [ ] 理解Hono框架基础
- [ ] 追踪一个HTTP请求的完整流程
- [ ] **实践任务**: 添加一个 `/api/hello` 路由,返回JSON

### Week 2: 工具系统
- [ ] 阅读 `src/tool/registry.ts` (工具注册)
- [ ] 学习Zod schema验证
- [ ] 阅读简单工具:
  - [ ] `src/tool/read.ts` (读文件)
  - [ ] `src/tool/write.ts` (写文件)
  - [ ] `src/tool/glob.ts` (文件搜索)
- [ ] 理解工具的输入输出格式
- [ ] **实践任务**: 创建一个自定义工具(例如统计代码行数)

### Week 3: 会话和Provider
- [ ] 阅读 `src/session/index.ts` (会话管理)
- [ ] 理解Session的生命周期
- [ ] 理解消息压缩机制 `src/session/compaction.ts`
- [ ] 阅读 `src/provider/registry.ts` (Provider注册)
- [ ] 阅读一个Provider实现 `src/provider/anthropic.ts`
- [ ] **实践任务**: 修改一个Provider的默认参数(如temperature)

**难度**: ⭐⭐⭐⭐☆

---

## 📋 阶段4: 前端界面 (预计1-2周)

### SolidJS基础
- [ ] 完成SolidJS官方教程前5章
- [ ] 理解Signal, Effect, Memo
- [ ] 学习组件通信(Props)
- [ ] 练习: 创建一个简单的SolidJS应用

### TUI实现
- [ ] 阅读 `src/cli/cmd/tui/app.tsx` (终端UI入口)
- [ ] 理解WebSocket连接管理
- [ ] 追踪消息从服务器到UI的渲染流程
- [ ] 阅读OpenTUI框架基础

### Web应用
- [ ] 启动Web应用:
  ```bash
  cd packages/app
  bun dev
  ```
- [ ] 阅读 `packages/app/src/` 主要组件
- [ ] 理解状态管理方式
- [ ] **实践任务**: 修改UI样式(改变主题颜色)

**难度**: ⭐⭐⭐☆☆

---

## 📋 阶段5: 高级主题 (预计3-4周)

### LSP集成 (困难)
- [ ] 学习LSP协议基础知识
- [ ] 阅读LSP官方文档关键章节
- [ ] 阅读 `src/lsp/client.ts`
- [ ] 理解如何启动LSP服务器
- [ ] 追踪一个"跳转到定义"请求
- [ ] **实践任务**: 添加对新语言的LSP支持

### MCP集成 (困难)
- [ ] 学习Model Context Protocol文档
- [ ] 阅读 `src/mcp/` 目录
- [ ] 理解OAuth认证流程
- [ ] 测试连接一个MCP服务器
- [ ] **实践任务**: 创建一个简单的MCP服务器

### Agent系统 (困难)
- [ ] 阅读 `src/agent/` 目录
- [ ] 理解不同Agent类型(build, plan, explore)
- [ ] 研究Agent的prompt工程
- [ ] 理解Agent如何决策使用工具
- [ ] **实践任务**: 在 `.opencode/` 创建自定义Agent

### 桌面应用 (中等)
- [ ] 学习Tauri框架基础
- [ ] 阅读 `packages/desktop/src-tauri/`
- [ ] 理解Rust代码和TS代码的通信
- [ ] 构建桌面应用:
  ```bash
  cd packages/desktop
  bun run tauri build
  ```

**难度**: ⭐⭐⭐⭐⭐

---

## 🏆 进阶实践项目

完成基础学习后,选择以下项目深化理解:

### 项目1: 简单工具开发 (1-2天)
- [ ] 需求: 创建一个"代码复杂度分析"工具
- [ ] 功能: 统计函数数量、代码行数、圈复杂度
- [ ] 文件: `.opencode/tools/complexity.ts`

### 项目2: 自定义Agent (3-5天)
- [ ] 需求: 创建"代码审查Agent"
- [ ] 功能: 自动检查代码风格、潜在bug
- [ ] 文件: `.opencode/agents/code-reviewer.ts`

### 项目3: 新Provider支持 (5-7天)
- [ ] 需求: 添加本地Ollama模型支持
- [ ] 功能: 可以使用本地运行的LLM
- [ ] 文件: `src/provider/ollama.ts`

### 项目4: UI功能增强 (1周)
- [ ] 需求: 添加"代码diff对比"视图
- [ ] 功能: 显示修改前后的代码差异
- [ ] 文件: `packages/app/src/components/diff-viewer.tsx`

### 项目5: MCP服务器开发 (1-2周)
- [ ] 需求: 创建一个GitHub集成MCP服务器
- [ ] 功能: 查询issues、创建PR
- [ ] 技术: Node.js + MCP SDK

---

## 📊 学习进度追踪

| 阶段 | 开始日期 | 完成日期 | 完成度 | 笔记 |
|------|---------|---------|--------|------|
| 阶段1: 基础准备 | | | 0% | |
| 阶段2: 环境搭建 | | | 0% | |
| 阶段3: 核心架构 | | | 0% | |
| 阶段4: 前端界面 | | | 0% | |
| 阶段5: 高级主题 | | | 0% | |

---

## 💡 学习技巧

### 1. 使用调试工具
```typescript
// 在关键位置加断点或日志
console.log('[DEBUG]', '变量名:', value);
```

### 2. 小步修改验证
```bash
# 修改一行代码 → 保存 → 观察效果 → 理解原理
```

### 3. 写测试用例
```typescript
// 为你理解的模块写测试
import { describe, test, expect } from 'bun:test';

describe('MyTool', () => {
  test('should work correctly', () => {
    // ...
  });
});
```

### 4. 做笔记
- 记录遇到的问题和解决方案
- 画架构图帮助理解
- 记录不懂的概念,后续查资料

### 5. 提问技巧
在GitHub Issues或社区提问时:
- 描述你的目标
- 说明你已经尝试了什么
- 提供错误信息和代码片段

---

## 🆘 遇到困难时

### 常见问题排查

**问题1: 依赖安装失败**
```bash
# 清理缓存重试
rm -rf node_modules bun.lock
bun install
```

**问题2: 类型错误**
```bash
# 检查TypeScript配置
cat tsconfig.json
# 重新生成类型
bun run typecheck
```

**问题3: 找不到代码在哪**
```bash
# 使用grep搜索
grep -r "关键字" packages/opencode/src/
# 或使用VS Code全局搜索 (Ctrl+Shift+F)
```

**问题4: 不理解代码逻辑**
- 使用VS Code的"Go to Definition" (F12)
- 使用VS Code的"Find All References" (Shift+F12)
- 画流程图帮助理解

---

## 📚 推荐学习资源

### 视频教程
- TypeScript深入理解 (YouTube搜索)
- SolidJS实战教程
- LSP协议详解

### 书籍
- 《TypeScript编程》
- 《深入理解现代JavaScript》
- 《架构整洁之道》

### 文档
- [OpenCode官方文档](https://opencode.ai/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [SolidJS教程](https://www.solidjs.com/tutorial/introduction_basics)

---

## ✨ 学习目标检验

完成所有任务后,你应该能够:

- ✅ 独立搭建和运行OpenCode开发环境
- ✅ 理解请求从客户端到服务器到AI的完整流程
- ✅ 能够创建自定义工具和Agent
- ✅ 能够修改UI并理解前后端交互
- ✅ 能够为项目贡献代码(提PR)
- ✅ 能够解释OpenCode的架构给其他人

---

**开始日期**: ___________
**目标完成日期**: ___________
**实际完成日期**: ___________

加油!🚀 学习过程中有任何问题,欢迎查看 `ARCHITECTURE_GUIDE_CN.md` 获取详细解释。
