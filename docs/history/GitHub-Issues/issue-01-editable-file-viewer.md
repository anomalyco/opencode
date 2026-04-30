# Issue #01 — 功能请求：文件查看器支持编辑模式（含办公自动化场景论据）

**目标仓库**: https://github.com/sst/opencode
**状态**: 待提交
**语言**: 中文（后续视维护者活跃语言再决定是否转英文）
**前置**: 先搜索已有 issues 确认无重复

---

## Issue 正文

**标题**：功能请求：为 File Tab Content / 文件查看器增加编辑模式（Editable mode）

**正文**：

```markdown
## 为什么这个时机重要

opencode 的定位正在从「AI coding assistant」扩展到「**local-first AI workstation**」。越来越多的用户不只是用它写代码，也用它处理非纯代码的日常工作：写文档、整理笔记、写邮件草稿、跑办公自动化脚本。在这些场景下 opencode 相比其他替代品有天然优势：

- **比 Web 端 ChatGPT / Claude 更安全**：用户接入自己的 API key，密钥和文件都不出本机。
- **比 Web 端更方便**：文件就在磁盘上，不需要上传 / 下载 / 复制粘贴。
- **比「VS Code + Copilot」更聚焦**：不需要为了改一句话打开完整 IDE。

但目前这个场景有一个致命阻塞点：**AI 产出的文档经常只需要改一两个词就完美，用户却必须跳出 opencode、去外部编辑器改完再切回来**。这破坏了 all-in-one workstation 的体验闭环，也是我写这个 issue 的根本原因。

## 现状

打开任意文件后，右侧 Session Side Panel 的 File Tab Content 由 `@pierre/diffs` 的 `PierreFile` 渲染，**完全只读**，只支持行评论。这个设计对「AI 产出的变更审查」场景很合理，但在以下场景不合适：

## 典型工作流受阻举例

**场景 1 — 文档润色**：我让 AI 写一份 release notes，产出 90% 正确，我想把 "significant improvements" 改成 "meaningful improvements"。今天的流程是：在终端敲 `code <file>` → 切到 VS Code → 改 → 保存 → 切回 opencode。**为了改一个词，4 次上下文切换**。

**场景 2 — 配置微调**：AI 生成了 `docker-compose.yml`，我只想把内存限制从 2g 改到 4g。同样 4 次切换。

**场景 3 — 办公自动化用户（增长中的用户群）**：非开发者把自己的 API key 接到本地 opencode，用来处理 `.md` 笔记、`.txt` 草稿、`.csv` 表格。对这群用户来说，「跳到外部编辑器」意味着打开 Notepad，工具链断裂感比开发者更明显，他们甚至可能因此放弃 opencode 而退回到 Web 端。

## 方案提议

在 `FileTabContent`（`packages/app/src/pages/session/file-tabs.tsx`）增加 edit 模式开关：

- 开启编辑模式时，**不改动 `PierreFile`**，而是在 FileTabContent 层 **分支渲染路径**：切换到一个轻量 CodeMirror 6 编辑器替代 PierreFile
- 编辑态下暂时隐藏 Line Comment Layer（行锚点在编辑过程中必然失效，这是底层设计决定的）
- 工具条显示 Save / Cancel 按钮 + 未保存指示器
- 保存时通过新增的 Tauri command `write_text_file` 落盘
- `review` tab 完全不受影响，diff 视图保持只读

关键词：**不是让 PierreFile 变得可编辑**，而是让 FileTabContent 在编辑模式下 bypass 整个 PierreFile 渲染路径。两条路径共存，互不干扰。

## 我已经理解到的设计约束

- `@pierre/diffs` 是一个 diff 渲染引擎，不是编辑器——让它原生支持编辑在设计上讲不通。所以方案**不碰** PierreFile。
- 行评论层和文件正文通过行号坐标耦合，编辑态下行号会变化，评论锚点必然错位。所以编辑态必须隐藏行评论，这是设计决策不是遗漏。
- Review tab 走的是 `SessionReview` 渲染 diff，跟普通文件 tab 完全是不同路径，本提案不涉及 Review tab。
- 二进制文件 / >10MB 大文件 / Windows readonly 属性文件在 UI 层禁用编辑按钮，避免 CodeMirror 卡死或误写。

## 竞品参考

同类本地 AI 工具在「原位编辑」这一点上都已实现：Cursor（Monaco）、Zed（native editor）、Continue.dev（借 VS Code 扩展）。**在这个产品品类里，只读的文件视图目前是 opencode 独有的状态**。

## 待讨论的开放问题

1. edit 模式应该是 feature flag 渐进推出，还是直接默认可用？
2. 编辑过程中 AI 的 Write tool 同时修改了这个文件怎么处理？**我的初步建议**：加载时记录 mtime，保存前对比，不一致则弹 "磁盘已变更，[覆盖 / 重新加载并放弃我的修改]"。
3. 在 SolidJS 的响应式系统里挂 CodeMirror 6 有没有已知的稳定性坑？（Solid 的 fine-grained reactivity 和 CodeMirror 自己的 EditorState 之间的边界处理）

## PR 意愿

本地已完成 Phase 0 prototype（SolidJS + CodeMirror 6 + Tauri `write_text_file` 端到端链路），若方案方向得到确认，可以在 1-2 周内提交 draft PR 供 review。欢迎在合入前先对齐设计。
```

---

## 提交前检查清单

- [ ] 在 https://github.com/sst/opencode/issues 搜索关键词：`editable`, `edit file`, `text viewer`, `file tab edit`, `CodeMirror`, `editable viewer`
- [ ] 确认无重复或高度相似的 issue
- [ ] 如有相似 issue，改为在该 issue 下评论补充方案
- [ ] 根据搜索结果调整措辞（引用已有讨论 / at 关键讨论者）
- [ ] 确认本地 Phase 0 prototype 确实跑通后再发（"可以在 1-2 周内提 PR" 不能是空头支票）
- [ ] 若维护者主要用英文沟通，转译英文版后再发
- [ ] 提交 issue 后在 `沟通记录.md` 记录 issue 号与提交日期
