---
feat-id: auto-save-debounce-flush
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# auto-save-debounce-flush — 1-spec

> **数据安全套件收尾**:文件查看器编辑态 debounce auto-save + 切 tab/关窗口 flush(Obsidian 风混合方案 C)

## 需求来源

2026-05-21 user 落地大文件预览防护后讨论数据丢失痛点:user 编辑文件未 Save → 切 tab / 关窗口 → 改动直接丢。这跟今天的 `large-file-preview-guard` 是同一防御维度(防数据丢失)。

讨论 3 方案(A dirty tab 拦截弹窗 / B 纯 auto-save / C 混合 debounce auto-save + flush)→ user 拍 **C + debounce 1s + 先做主流程**。

> Obsidian 是最强参考(本地 MD 编辑器,debounce auto-save + 跟外部改文件兼容,产品形态最接近 DeskFox)。

## 验收标准

| ID | 场景 | 期望 |
|---|---|---|
| **A1** | 编辑文件,改 1 字符,不再操作 | 1 秒后自动 save(磁盘文件已含新内容) |
| **A2** | 编辑文件,连续改 5 秒(不停打字)| 期间不 save(debounce 等待),停手后 1 秒 save |
| **A3** | 编辑文件,改了几句,**直接切到另一个 tab**(不点 Save 也不等 debounce)| 切 tab 前 flush:同步 save → tab 切走;新 tab 加载后老文件磁盘已含改动 |
| **A4** | 编辑文件,改了几句,**点 ❌ 关 app** | 关闭前 flush:同步 save 所有 dirty 编辑器 → app 关闭;下次启动文件已含改动 |
| **A5** | 编辑 .md 时 AI 同时 chat 改同文件 | 走现有 mtime 冲突机制(saveEdit 已有),弹"覆盖 / 重载"提示 |
| **A6** | Save 失败(readonly / 磁盘满)| 不静默吞,toast 报错,保持 editing 状态不丢 draft |
| **A7** | 编辑文件改了几句,**点 Cancel(放弃编辑)** | 现有 cancelEdit 行为不变 — 不 flush,直接丢 draft |
| **A8** | 没编辑(读模式)切 tab / 关窗口 | 行为不变,不触发 flush 逻辑 |

## 架构选型

### 三方案对比(决策已落)

| 方案 | 用户体验 | AI 改文件冲突 | "放弃所有改动" | 工程量 | 选 |
|---|---|---|---|---|---|
| A dirty tab 拦截弹窗 | 切 tab/关窗口弹三选 | ✅ 兼容 | ✅ 一键放弃 | 2-3 天 | ❌ |
| B 纯 auto-save | 完全无打断 | ⚠️ 冲突频率上升 | ❌ 已落盘 | 1-2 天 | ❌ |
| **C 混合(本笔)** | 零打断 + flush 兜底 | ✅ 走现有 mtime | 🟡 妥协(可加 secondary feature)| 2-3 天 | ✅ |

### C 方案三个组件

```
┌────────────────────────────────────────────────────┐
│  1. Debounce auto-save                             │
│     editing 中 draft 变化 → 启动 1s 计时器          │
│     1s 内再变 → reset 计时器                       │
│     1s 静默 → 自动调 saveEdit()                    │
├────────────────────────────────────────────────────┤
│  2. Tab switch flush                               │
│     tab 切换前(view.setTab/setActive 之类前置)    │
│     if (editing && draft != contents) → 同步 flush │
│     flush 完成才切换                                │
├────────────────────────────────────────────────────┤
│  3. Window close flush                             │
│     Tauri prevent_close handler 加 dirty 检测      │
│     全局收集所有 dirty 编辑器 flush                 │
│     等 flush 全 done 才 close                       │
└────────────────────────────────────────────────────┘
```

## 关键技术决策

### D1 — debounce 时长 = **1 秒**(user 已拍)

行业参考:
- VSCode `files.autoSave: afterDelay` 默认 1000ms
- Obsidian ~500ms-2s 之间(动态)
- 1s 是"打字停顿 vs 反应灵敏"的甜区

### D2 — flush 同步阻塞 vs 异步

**同步阻塞**(本笔采用):
- 切 tab / 关窗口 → 显示短暂"保存中..."loading → save done → 切换
- 优点:保证不丢数据 + 简单可控
- 缺点:user 短暂被 block(实际 saveEdit 一般 <50ms,可接受)

异步(否决):flush 触发了但不等完成 → 切换 → 如果 save 慢 / 失败,改动丢
反过来:本地 IO 几乎瞬间,同步成本低,选同步更稳。

### D3 — mtime 冲突场景(user 改 / AI 同时改)

走**现有 saveEdit 的 mtime 检测机制**(`查看器-自动刷新` feat 已落):
- saveEdit 调 invoke `write_text_file` 时带 `expected_mtime`
- 后端检测 mtime 不一致 → 返错 → 前端弹"覆盖 / 放弃重载"
- auto-save 频率高的潜在影响:**冲突弹窗可能更频繁**,但跟 user 主动 save 走同一处理,**不引入新交互**

### D4 — Auto-save 时是否 toast?

**否**(频率太高会烦):
- user 主动 Save 按钮按 → 保留 toast 提示
- Auto-save 静默,只在失败时 toast 报错
- Tab 标题加 dirty 小圆点 ●(可选,加在 secondary 段)

### D5 — debounce timer cleanup

editing 退出(saveEdit / cancelEdit 完成)→ 清 timer
组件 unmount → 清 timer
file path 切换(同 tab 切到别的文件)→ flush 当前 timer 再切

### D6 — 不做的(本笔 scope 外)

- **"放弃所有改动"功能**(还原文件到上次 save / git HEAD)— 单独 secondary feat,等 user 撞真实场景再做
- **Tab 标题 dirty 小圆点 / 星号 UI 提示** — 跟 auto-save 体验有冲突(都 auto-save 了为啥还提示 dirty?),先不做,等用户反馈
- **多个 dirty tab 共存场景**(同时编辑 N 个文件)— 当前 file-tabs.tsx 一次只能 editing 一个文件(Match when editing only on active tab),多 dirty 场景不存在
- **关 app 不 prevent_close 直接 force kill**(任务管理器杀)— 不可拦截,接受现状

## 改动落点(预判,需细化在 2-plan)

| 文件 | 性质 | 改动 |
|---|---|---|
| `packages/app/src/pages/session/file-tabs.tsx` | 改 | debounce auto-save + tab switch flush 钩子 |
| `packages/desktop/src-tauri/src/lib.rs` | 改 | `prevent_close` handler 加 dirty flush event emit |
| `packages/app/src/utils/debounce.ts`(可能新) | 新 | pure debounce helper(可单测,R5 决策 2 logic 清单)|
| `packages/app/src/pages/session.tsx` | 可能改 | tab 切换 hook 位置(取决于调研)|

## R 合规预判

- **R2** FORK marker 新加段
- **R3** 不涉及
- **R4** 0 override(全 fork 白名单)
- **R5** Medium feat,helper extract pattern:`debounce.ts` pure helper unit test ≥ 3 个边界;集成路径(saveEdit / flush / window close)由 user runtime 验收(同 large-file-preview-guard 路径)
- **R6** 不涉及

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| **AI 改文件冲突弹窗频率上升**(D3)| 现有 mtime 机制已成熟处理,跟主动 save 同代码路径,不引入新交互 |
| **关 app 时 save 失败 user 不知道**(磁盘满 / 权限)| flush handler 收集 save 错误,显示 dialog "<filename> 保存失败,是否仍要关闭?",拦截一次 |
| **多组件协调"我有 dirty"机制需要全局 store** | 当前只有 file-tabs.tsx 一处编辑(file viewer),不需要全局,本笔不引入复杂度;未来若有"chat 输入框 dirty / 表单 dirty"等场景再加 |
| **debounce timer 漏 cleanup 内存泄漏** | createEffect / onCleanup 强制 timer clearTimeout,unit test 覆盖 |
| **极端场景:user 在 1s debounce 等待中关 app** | window close flush 兜底 flush 当前 timer 内容 |

## 工程量估算

- Phase 1:debounce helper + auto-save 接入(~80 行 + 单测 30 行)— **0.5-1 天**
- Phase 2:tab switch flush(~30 行)— **0.5 天**
- Phase 3:window close flush(Tauri prevent_close 扩 + 前端事件桥接,~50 行)— **0.5-1 天**
- 三文档 + INDEX + 改动日志(~250 行)— **0.5 天**

**总:2-3 天**,Medium 规模(~200 行代码 + ~250 行文档 = ~450 行,在 50-500 范围内)。

## 待 user 审签

请 review 上述决策,特别是:

1. **scope 是否对齐"先做主流程"**:Phase 1+2+3 都做 = 完整主流程;**只 Phase 1 = 最小 auto-save** 也能算"主流程"吗?
2. **D4 auto-save 是否 toast**:本笔决议**不 toast**,user 同意吗?
3. **D6 "Tab 标题 dirty 小圆点"是否本笔做**:本笔决议**不做**(跟 auto-save 体验冲突),user 同意吗?
4. **D6 "放弃所有改动"功能**:本笔决议**不做**(secondary feat),user 同意吗?

审签后我开 2-plan + 动手实施。
