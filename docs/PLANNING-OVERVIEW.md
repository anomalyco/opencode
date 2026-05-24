# OpenCode 文件查看器可编辑 — 项目仪表盘

## 项目目标

把 opencode 桌面 app 的文件查看器（File Tab Content）从只读 + 行评论，改造成**真正可编辑的编辑器**，改完能写回磁盘。最终产出是**稳定可分发的 exe**，面向自己 + 小范围人群（朋友 / 同事 / 内部团队）。

双轨策略（已确定）：
- **轨道 1**：在 anomalyco/opencode 提 issue 探官方态度，争取 PR 合入，长期零维护。
- **轨道 2**：fork 做自用版本，立刻能用、立刻能分享。

## 当前状态（2026-04-24）— 🎉 MVP v1.2 达成(含 Save 安全护栏)

| 维度 | 状态 |
|---|---|
| 规划阶段 | ✅ 01-10 文档成稿(09 改动规则含 8 道护栏) |
| Phase 0 prototype | ✅ L1-L4+L6 通过(`proto-l-all-pass`) |
| Phase 1 fork + 关键风险 | ✅ `@pierre/diffs` 验证 **Apache-2.0 开源**,Plan B 永久退役 |
| Phase 2 核心改动 | ✅ 静态 typecheck + cargo check + runtime 全过(`phase-2-editable-file-viewer-static-ok`) |
| **Phase 3 Save 安全护栏** | ✅ **mtime 冲突 + readonly + 二进制 + 大文件** 全过 user 亲验(`mvp-v1.2-save-safety`) |
| Phase 4 release build | ✅ `OpenCode.exe` 25 MB **无 console**,跑通 Phase 2+3 所有功能 |
| 本地 artifacts(推荐分发) | ✅ `D:\artifacts\opencode-mvp-v1-release\{OpenCode.exe, opencode-cli.exe, opencode_lib.dll}` 178 MB |
| Fork 双主仓 | ✅ `gitee:zoulukuang/opencode-for-office` + `github:yuesoue/opencode-for-office`(`git push origin` 自动双写)|
| dirty 切 tab / 关窗口拦截 | 🟡 挂账(opencode reactive 系统改动面大,等真实反馈驱动) |
| NSIS installer | 🟡 挂账(SignTool 缺,小范围裸 exe + dll 够用) |
| Issue 提交(轨道 1) | 🚫 暂搁 — 素材保留,待 MVP 反馈后再评估 |

**路线回顾(2026-04-24)**:① 放弃 Linux 开发,全程 Windows 本机 ② 轨道 1 暂搁,只做轨道 2 ③ B 路径(静态验证 + 打包 runtime 验证),跳过 dev 环境搭建无底洞。**2 个日历日达成 MVP v1.2**(原估算 6-12 天);同日连续迭代三次:MVP v1 初版 → v1.1 Save bug fix → v1.2 Save 安全护栏。

## 下一步(按优先级)

1. **[建议] 发朋友圈收反馈**
   - 打包 `D:\artifacts\opencode-mvp-v1-release\` **三个文件**(OpenCode.exe + opencode-cli.exe + opencode_lib.dll)发 1-3 位朋友
   - 告知:必须三个文件同目录 + 只双击 `OpenCode.exe` + 需 WebView2(Win11 自带)+ CPU 支持 AVX2 + SmartScreen 弹窗点"仍要运行" + 与官方 opencode 共存(共享 session/config,不覆盖)
2. **按反馈决定下一步**
   - "经常撞 mtime 冲突"(AI+手动并发高频) → 加 Phase 3 挂账的 B 方案(SSE 提前感知)
   - "切 tab 丢内容" → 加 dirty 拦截对话框(挂账项)
   - "想要 installer" → 补装 Windows SDK Signing Tools,打 NSIS
3. **rebase upstream**(每 2-4 周)
   - `cd D:\project\opencode-fork && git fetch upstream && git tag pre-rebase-$(date +%Y-%m-%d) main && git checkout main && git rebase upstream/dev && git push origin main --force-with-lease`(2026-05-21 起主分支 dev → main,上游主分支仍是 dev)
   - 再把 `feat/editable-file-viewer` rebase 到新 main

详细阶段清单与进度追踪见 [STATUS.md](./STATUS.md)。

## 关键发现（规划期的反直觉结论）

- **插件方案不可行**：opencode 插件系统没有暴露文件查看器 UI 扩展点，只能工具调用层面介入（见 [./history/规划-archive/06](./history/规划-archive/06-插件方案能力边界.md)）。
- **外部程序就地改造不可行**：Tauri app 启动后注入 JS 受 CSP / 进程隔离阻断（见 [./history/规划-archive/07](./history/规划-archive/07-外部程序改造路径分析.md)）。
- **③ 文件树不刷新问题不是"没 watcher"**：sidecar 已发 SSE `file.watcher.updated`，根因是前端 `watcher.ts` 对 `add` 事件的 `if (!ops.isDirLoaded(parent)) return` 懒惰丢弃。
- **`@pierre/diffs` 是关键风险点**：Pierre 公司私有 npm 包，fork 后 `bun install` 能否拉到是第一个阻塞验证项（详见 [./history/规划-archive/04](./history/规划-archive/04-风险与备选方案.md)）。

## 文档索引

### 规划文档（已稳定，不主动改）

| 文件 | 内容 |
|---|---|
| [./history/规划-archive/01-架构定位.md](./history/规划-archive/01-架构定位.md) | 文件查看器在源码里对应哪个组件、完整渲染链路 |
| [./history/规划-archive/02-改造方案.md](./history/规划-archive/02-改造方案.md) | fork + CodeMirror 模式切换的详细实施步骤 |
| [./history/规划-archive/03-工程量与稳定性评估.md](./history/规划-archive/03-工程量与稳定性评估.md) | **重点**：工时估算、稳定性风险、是否适合分发 |
| [./history/规划-archive/04-风险与备选方案.md](./history/规划-archive/04-风险与备选方案.md) | 阻塞风险（`@pierre/diffs` 访问权限）、Plan B |
| [./history/规划-archive/05-验证清单.md](./history/规划-archive/05-验证清单.md) | 验证步骤、回归测试点 |
| [./history/规划-archive/06-插件方案能力边界.md](./history/规划-archive/06-插件方案能力边界.md) | **插件能不能实现文件查看器内编辑** — 答：不能，附证据 |
| [./history/规划-archive/07-外部程序改造路径分析.md](./history/规划-archive/07-外部程序改造路径分析.md) | **外部程序就地改造** — 答：不能，附术语统一表 |
| [./history/规划-archive/08-最终策略与实施清单.md](./history/规划-archive/08-最终策略与实施清单.md) | 双轨并行策略详细实施步骤与时间表（静态） |
| [./governance/改动规则.md](./governance/改动规则.md) | **大型项目防误伤指南**：7 道护栏 + AI 操作内化护栏 + 回滚演练 |

### 活文档（持续更新）

| 文件 | 用途 |
|---|---|
| [STATUS.md](./STATUS.md) | Phase 0-5 动态进度追踪（08 的活版本） |
| [./history/沟通记录.md](./history/沟通记录.md) | 每次对话结论的流水账，便于回溯决策脉络 |

### 提交素材

| 文件 | 状态 |
|---|---|
| [./history/GitHub-Issues/issue-01-editable-file-viewer.md](./history/GitHub-Issues/issue-01-editable-file-viewer.md) | 可编辑文件查看器功能请求（含办公自动化战略论据） |
| [./history/GitHub-Issues/issue-02-file-tree-auto-refresh.md](./history/GitHub-Issues/issue-02-file-tree-auto-refresh.md) | 文件树不自动刷新（双路径：评论 #23616 / 独立 issue） |

## 本仓库的角色（2026-04-28 更新）

**本仓库 `opencode-fork`(发行版品牌 DeskFox) = anomalyco/opencode 的 fork**，承担规划 + 治理 + 历史 + 真实 fork 代码,**全部统一在一个 git 仓内**。

| 内容 | 位置 | 性质 |
|---|---|---|
| 治理 / 当前活规则 | `docs/governance/` | fork-only,不会被上游 merge 影响 |
| 规划档案(原 01-08, 11) | `docs/history/规划-archive/` | 历史快照,锁死不改 |
| 项目概述 / 实施状态 / 沟通记录 | `docs/PLANNING-OVERVIEW.md` / `docs/STATUS.md` / `docs/history/沟通记录.md` | 概览 + 持续更新 + 时光胶囊 |
| 功能文档(规范 v2 起) | `docs/features/<feat-id>/{1-spec,2-plan,3-changelog}.md` | 每 feature 一目录 |
| Issue 素材 | `docs/history/GitHub-Issues/` | 轨道 1 已搁置 |
| **fork 源码**(主体) | `packages/`(上游) + `packages/branding/`(fork-only) | 标准 monorepo |

fork 改动追踪:`改动日志.md`(根目录,索引表)+ 各 feature 的 `3-changelog.md`(详情)。完整规则见 [./governance/改动规则.md](./governance/改动规则.md)。

> **历史变更**:
> - 2026-04-23:原计划 prototype 放 `D:\project\opencode-editable-prototype` 独立仓,改为 opencode-plan/`prototype/` 子目录(方案 B)
> - 2026-04-28:opencode-plan 仓所有 fork 相关文档(规划 / 治理 / 沟通 / Issue / 实施状态)迁入本仓 `docs/`,opencode-plan 仅保留 prototype 原型代码归档
