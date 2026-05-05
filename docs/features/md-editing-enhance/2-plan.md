---
feat-id: md-editing-enhance
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 实施计划 + 决策轨迹

## 实施总览

按 1-spec D2-Tier B 全套 + Ctrl+F 落地。**11 项** scope 一笔 commit 完成(中等规模,11 项内聚不需要拆 phase)。

| 步骤 | 内容 | 工作量(实际)|
|---|---|---|
| 1 | 1-spec 锁版(吸收需求池 obsidian-md编辑体验.md + 保存后双提示框.md + 保存后提示优化.md) | 30 min |
| 2 | 加 `@codemirror/search` dep,扩展 `code-mirror-view.tsx` 接受 `extraExtensions` prop | 10 min |
| 3 | 写 `markdown-editor-extensions.ts` — 集合 11 项 markdown 命令 + drag/paste handlers + foldGutter + search | 1.5 小时 |
| 4 | `file-tabs.tsx` 编辑态注入 markdown 扩展 + saveEdit 修双提示框 fix | 15 min |
| 5 | `context/file.tsx` 加 toast id 跟踪 + dismissDirtyConflict helper | 10 min |
| 6 | typecheck + DeskFox.exe build | 5 min |
| **总** | | **~2.5 小时 AI 辅助**(对应 1-spec 估算 1.9 工作日) |

实施期间无 scope 偏移,11 项均按 1-spec 落地。

## 关键决策轨迹

### 1. CodeMirror Command 模式 vs paste/drop 钩子

CM6 有两种交互方式:
- **`Command` 配 keymap**:适合键盘触发(Enter / Ctrl+B / Ctrl+Enter / Tab)
- **`EditorView.domEventHandlers`**:适合鼠标/系统事件(paste / drop)

按交互形态分:
- 列表续延 / Ctrl+B/I/K / Ctrl+Enter / Tab → Command
- 智能 URL 粘贴 / 拖图 / 截图粘贴 → domEventHandlers

### 2. paste handler 内多场景判定

paste 事件需要同时处理两类场景:
1. URL 粘贴(选区非空 + clipboard 是 URL → wrap link)
2. 截图粘贴(clipboardData.items 含 image/* → 写文件 + 插入引用)

实施:在 paste handler 内**先判 URL 智能粘贴**,不命中再判截图。两条互不干扰(URL 检测要求选区非空,截图本身没文本选区要求)。

### 3. 拖图存盘策略 — 同目录 + 唯一文件名

**v1 简化**:写到当前 .md 文件**同目录**,文件名 `pasted-{timestamp}-{原文件名}`。

理由:
- 简单可靠(不需要建 Attachments/ 子目录约定,避免目录已存在/权限等边界)
- 后续如果用户希望走 Attachments/,可加 v2 配置项
- timestamp 避免文件名冲突
- 与 Phase 1 protocol 配合(同目录的相对路径 `![](pasted-X.png)` 自然渲染)

### 4. 列表续延 — 4 个正则按优先级排

`LIST_PATTERNS` 数组顺序很重要:
1. **task list**(`- [ ] xxx`)— 必须先匹配,因为 task list 也匹配 plain bullet 模式
2. **numbered**(`1. xxx`)
3. **plain bullet**(`- xxx` / `* xxx` / `+ xxx`)
4. **blockquote**(`> xxx`)

按这个顺序,task list 先消耗优先级最高的格式。

### 5. dirtyConflict toast id 跟踪

修双提示框 bug 必须能 dismiss 已有 toast。`showToast` 返回 toast id(Kobalte `toaster.show()` 返回 number)。

设计:
- `notifyDirtyConflict` 捕获 id 存 `Map<path, id>`
- 同 path 重复 notify 时,**先 dismiss 旧 toast**(避免叠加,防"洪泛"原意图保留)
- 新增 `dismissDirtyConflict(path)` 暴露给 file-tabs.tsx
- saveEdit 成功 / Overwrite / Reload from disk 三个分支都调一次

副作用 0 — dirtyConflict 的设计意图是"提醒保存时的覆盖选择",保存动作完成后该提醒已无意义。

### 6. 表格 Tab — v1 简化

Spec 提到"表格 Tab 跳格 + Enter 加新行 + 自动对齐管道符"。v1 只做 **Tab 跳到下个 `|`**(最高频);Enter 加新行 + 自动对齐放 v2(独立功能,工程量稍大,跨多行编辑复杂)。

## R4 override 评估 — 0 笔!

本笔所有改动都在 `packages/app/`(非黑名单):

| 文件 | R4? |
|---|---|
| packages/app/package.json(加 dep) | ❌ packages/app 不在 blacklist |
| packages/app/src/utils/markdown-editor-extensions.ts(新文件) | ❌ 同上 |
| packages/app/src/components/code-mirror-view.tsx(扩展 prop) | ❌ |
| packages/app/src/pages/session/file-tabs.tsx(注入扩展 + dismissDirtyConflict) | ❌ |
| packages/app/src/context/file.tsx(toast id 跟踪 + dismiss helper) | ❌ |

**比 md-office-improvements 那 7 笔 R4 改观巨大** — 编辑器栈全在 app 层,packages/ui/ 不需要动。

## 与现有 feat 的协同

- **Phase 1 protocol**(md-office-improvements):拖图写盘后 markdown 引用 `![](pasted-X.png)`,渲染走 protocol 自然显示。**0 额外工作**
- **markdown 渲染样式**(md-office-improvements):查看模式下 `![](pasted-X.png)` 走 fixLinkTargets 不会被加 target=_blank;callout/脚注/mermaid 不受编辑器影响。**0 回归**
- **dirtyConflict 设计**(查看器-自动刷新):本笔修双提示框 bug 不破坏原"AI 改了文件提醒"语义;提醒在 save 完成时使命结束 → 自动 dismiss 是合理增强

## 经验沉淀

1. **CodeMirror 6 加扩展点**(extraExtensions prop 模式)— 比 hardcode 一堆扩展进 wrapper 灵活,后续不同文件类型可注入不同扩展
2. **toast id 跟踪 + dismiss**是 Kobalte/几乎所有 toast 库标配,但要主动用(默认 showToast 不返回 id 用)— 改 file.tsx 一处即可解锁所有"按事件主动 dismiss"场景
3. **Markdown 命令实施模板** — wrapSelection / matchLinePattern / dispatch insert 三件套覆盖 80% markdown 编辑命令,本笔代码可复用到将来其他 markdown 智能输入(如 GFM 表格生成、链接补全)
