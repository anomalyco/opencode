---
feat-id: md-editing-iter-2
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-editing-iter-2 — .md 编辑体验第二轮优化(基础体验三项)

## 需求来源

- 2026-05-09 user 用编辑器后反馈:长行不软换行(右边出横滚条),选中文字底色不明显,写到第几行不知道
- iter-1(`md-editing-enhance`,2026-05-05 落地 `b2952d56c`)交付 Tier B 全套 + Ctrl+F 共 11 项,本笔在此基础上补**基础体验空白**

## Scope:3 项(D4=B 拆分,AI 改写选区单独后续 feat)

### 项 1 — 长行软换行(P0,5 分钟)

**问题**:CodeMirror 6 默认不软换行,长段落右边出横滚条要拉,无人这么读 .md。

**实现**:`packages/app/src/components/code-mirror-view.tsx` 加 `EditorView.lineWrapping` 进 extensions 数组。

**验收 A1**:
- A1.1 打开任意 .md 文件,改一行写到 200+ 字符,**不出现水平滚动条**
- A1.2 长行被软换行,行号只标"逻辑行"不标视觉折行
- A1.3 撤销栈不受影响(Ctrl+Z 仍按字符级回退,不按视觉行)

### 项 2 — 选区底色明显化(P0,10 分钟)

**问题**:当前选区底色 `--surface-raised-stronger`(中灰)跟当前行高亮 `--surface-raised-base` 区分度低,看不出选中没。同时 CM 没启用 `drawSelection` 扩展,行尾空白和换行处不绘底色 → 多行选中视觉断裂。

**实现**:
1. `code-mirror-view.tsx` 加 `drawSelection()` 进 extensions(CM 原生 API)
2. `packages/app/src/index.css:202-207` 把 `.cm-selectionBackground` / `::selection` 底色换成 DeskFox primary 半透明(目标值待 user 实测拍板,候选 `rgba(56, 139, 253, 0.35)` GitHub 蓝 / `color-mix(in oklab, var(--primary) 35%, transparent)`)

**验收 A2**:
- A2.1 单击拖选一行内的文字,看到明显蓝色底色
- A2.2 多行选中(Shift+ 方向键)从行首到行尾**完整连贯**,不断在行尾
- A2.3 选区底色在浅色 / 深色主题下都清晰可见
- A2.4 viewer 预览区(非编辑态)选中文字**保持原本系统选区色**(我们的 CSS 不渗透)

### 项 3 — 状态栏行/列号(P0,~0.2d)

**问题**:写到第几行第几列不知道,大文档难定位。

**实现**:
1. 新建 `packages/app/src/components/cm-status-bar.tsx`(SolidJS 组件)— 显示 `Ln 12, Col 34 · Sel 56` 格式
2. `code-mirror-view.tsx` 暴露 `onSelectionChange?: (info: { line: number; col: number; selLength: number }) => void` prop,内部用 `EditorView.updateListener` 在 `selectionSet`/`docChanged` 时回调
3. `file-tabs.tsx` 编辑态在编辑器下方挂状态栏,接收回调更新

**验收 A3**:
- A3.1 编辑态下方出现状态栏,显示当前行号/列号(从 1 起)
- A3.2 移动光标时实时更新
- A3.3 选中一段时显示选中字符数 `Sel N`,无选区时不显示
- A3.4 退出编辑态(Cancel/Save)状态栏消失
- A3.5 文档底部无内容区域因状态栏导致无法 scroll(布局合理)

### 项 4 — AI 改写选区(已拆分到独立 feat,本笔不做)

D4=B 决策:本笔风险隔离,项 4 单独 feat 后续做(暂定 feat-id `md-editing-ai-rewrite`)。理由:项 4 涉及 chat session 调用栈,真出 bug 会牵连聊天功能;基础 3 项不沾 chat,完全隔离便于回归与回退。

## R1-R4 合规

| 规则 | 评估 |
|---|---|
| **R1**(三级跳) | 主要走第 1 档:fork-only 新文件(`cm-status-bar.tsx` + AI 改写浮层组件 + 改写 command 文件)+ 已 fork 改造区(`code-mirror-view.tsx`/`file-tabs.tsx`)延伸 |
| **R2**(FORK marker) | 改 `code-mirror-view.tsx` / `file-tabs.tsx` / `index.css` 加 marker;新文件无需 |
| **R3**(品牌 hardcode) | 不触发(不动品牌字符串/主题色 token / icon)|
| **R4**(黑名单 override) | `packages/app/` 不在黑名单,本笔**0 R4 override** |

## R5 测试要求

本笔规模 = **Tiny-Medium 边界**(预估 < 100 行 / 影响 3-4 文件 / 单一主题)→ R5 要求 **≥ 3 unit**。

| 项 | 测试方案 |
|---|---|
| 项 1 软换行 | 视觉性,纳入手测验收 A1.1-A1.3 |
| 项 2 选区底色 | 视觉性,纳入手测验收 A2.1-A2.4 |
| 项 3 状态栏 | **unit**:新写 `cm-status-bar.test.tsx`,mock CM EditorView state,验证行/列计算正确(行 1+ / col 1+ / 多字符选区) — 至少 3 unit |

跑 `bun test` 全绿 + 现有单测 + 集成不回归。

## 跨链路独立性确认(2026-05-09 user 提)

本笔所有改动**只在编辑器代码路径**,不影响:
- ✅ MD viewer(预览渲染走 `packages/ui/src/context/marked.tsx` + `components/markdown.tsx`,完全独立代码路径,不读 CM 状态)
- ✅ MD → Word 导出(`md-export-docx.ts` 读磁盘 .md 文本,不读 CM 状态 / DOM)
- ✅ 文件保存路径(改完照常走 `saveEdit` → 写盘)

合并 dev 前会跑既有 147 单测 + 用 markdown-test.md 综合文档手测 viewer 预览渲染 + Word 导出回归。

## 工程量预估

| Phase | 工作量 |
|---|---|
| 项 1 + 项 2(软换行 + 选区色)| 0.1d |
| 项 3 状态栏(组件 + 单测) | 0.3d |
| typecheck + build + 三文档 + 自测 | 0.2d |
| **总** | **~0.6 工作日 / AI 辅助 1-2 小时** |

## 关联清理

| 需求 / 文件 | 处理 |
|---|---|
| `OPENCODE-PLAN/需求池/obsidian-md编辑体验.md` | 已 done(iter-1)— 本笔为 iter-2 增量,不修改原条目 |
| 主索引 `DeskFox.Ai 需求池.md` | 完成后在"已完成"section 加一行 iter-2,链接本 feat 三文档 |

## 决策签字

- **2026-05-09** user 拍板:
  - 锁定 3 项基础体验(软换行 / 选区色 / 状态栏),AI 改写选区拆出独立后续 feat
  - 跨链路独立性保证(预览/Word 导出不影响)
  - **D1=C**:选区色实施时出 2-3 候选给 user 选
  - **D2/D3 不适用**(项 4 deferred)
  - **D4=B**:风险隔离拆分
- spec 进 status:in-progress,Claude 直接实施
