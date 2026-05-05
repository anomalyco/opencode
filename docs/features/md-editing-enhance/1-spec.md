---
feat-id: md-editing-enhance
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# .md 编辑体验增强(Tier B 全套 + Ctrl+F)

## 需求来源

- `OPENCODE-PLAN/需求池/obsidian-md编辑体验.md` — Obsidian 风编辑体验调研论证
- `OPENCODE-PLAN/需求池/保存后双提示框.md` — 保存后双 toast bug
- `OPENCODE-PLAN/需求池/保存后提示优化.md` — 同根因,方案 A 落地

2026-05-05 user 拍板:**做 + Tier B 全套 + 加 Ctrl+F**。

## 背景:当前 .md 编辑能力(已比 spec 起点高)

`packages/app/src/components/code-mirror-view.tsx` 已经是 CodeMirror 6 SolidJS wrapper,`lang-from-ext.ts` 给 .md 传 `markdown({ base: markdownLanguage, codeLanguages })` 语言扩展。当前已具备:

| 能力 | 来源 |
|---|---|
| CodeMirror 6 编辑器 | code-mirror-view.tsx MVP |
| Markdown 语法高亮 | `@codemirror/lang-markdown` |
| 代码块嵌套语言高亮 | `lang-from-ext.ts` |
| 完整撤销栈 | `history()` extension |
| Tab 缩进 | `indentWithTab` |
| 默认键盘 | `defaultKeymap` |
| 行号 / 当前行高亮 | `lineNumbers()` + `highlightActiveLine()` |
| Edit / Save / Cancel UX | file-tabs.tsx editing state |
| Save 防呆(mtime/readonly/binary/大文件) | Phase 3 MVP |
| 切 tab 自动退出 editing | file-tabs.tsx |

**当前等价于 spec 里的 Tier B-light**(~55% Obsidian 体感)。本笔补到 Tier B 完整版(~75%)。

## 决策(user 锁版 2026-05-05)

| 点 | 答 | 含义 |
|---|---|---|
| **D1** | B 做 | 既然 CM6 集成成本已付,补完 Tier B 边际成本只剩 1.5d,放弃 Tier A textarea 退化路径 |
| **D2** | Tier B 全套 + Ctrl+F | 表 1(P0,4 项)+ 表 2(P1,5 项)+ `@codemirror/search` 即插用 |
| **D3** | A 双模式按钮 | 保留现有 Read/Edit 切换 UX,不上 split view 不上 Live Preview |
| **D4** | A 显式 Save 保留 + dirty 状态 + 关闭拦截 | 与 AI 助手并行改文件兼容,Save 后顺手修双提示框 bug |

## Scope:11 项(表 1+2+Ctrl+F)

### 表 1 — 4 项核心(P0)

| 项 | 实现要点 |
|---|---|
| 列表续延(`-` / `1.` / `- [ ]`) | 自写 `Enter` keymap command:读 markdown syntax tree,识别上一行 list item,自动续 prefix;空 item 再 Enter 退出列表 |
| Ctrl+B / Ctrl+I / Ctrl+K 格式化 | 3 个 commands:选区包 `**`/`_`/`[](url)`;选区为空时插入光标置中 |
| 拖图自动 `![](path)` | 监听 `EditorView.domEventHandlers({ drop, paste })`;复用 file-tree-dnd 的 base64 写盘(`write_binary_file_absolute_base64`)+ 计算相对路径 + dispatch insert |
| 修保存后双提示框 bug | save 成功分支调 toast dismiss API,清掉该 path 对应的 dirtyConflict toast(吸收 `保存后双提示框.md` + `保存后提示优化.md` 方案 A) |

### 表 2 — 5 项加分(P1)

| 项 | 实现要点 |
|---|---|
| Ctrl+Enter 切 `- [ ]` ↔ `- [x]` | 自写 command:读光标行,匹配 task list pattern,toggle bracket |
| 块引用 `>` 续延 | 同列表续延模板,匹配 `>` prefix |
| Heading 折叠 | `foldGutter` extension + lang-markdown 已带 fold support |
| 智能 URL 粘贴 | `EditorView.domEventHandlers({ paste })`:选区非空 + 粘贴内容是 URL → 改写 `[选中](URL)`;否则正常粘贴 |
| 表格 Tab 跳格 + 自动对齐 | 自写 markdown-table-keymap extension:Tab 跳到下个 cell,Enter 加新行,Save 时对齐管道符 |

### 即插模块(Ctrl+F)

| 模块 | 工作 |
|---|---|
| `@codemirror/search` | `import { search } from "@codemirror/search"` + 加进 extensions 数组;Ctrl+F 弹搜索面板,Ctrl+H 弹替换面板;支持正则、大小写、选区内查找 |

## 架构选型

### 文件结构

- 改 `packages/app/src/components/code-mirror-view.tsx`:接受 `extensions?: Extension[]` prop,append 到默认列表(让上层注入 markdown 专用扩展)
- 新建 `packages/app/src/utils/markdown-editor-extensions.ts`:导出 `markdownEditorExtensions(opts)` — 集合本笔所有 markdown 命令 + paste/drop handlers + foldGutter
- 改 `packages/app/src/pages/session/file-tabs.tsx`:.md 编辑态时把上面的 extensions 传给 `<CodeMirrorView>`
- 改 `packages/app/src/context/file.tsx`:dirtyConflict toast 加稳定 id,save 成功后 dismiss

### CodeMirror 6 命令模式

所有自写命令都遵循 CM6 `Command` 签名:`(view: EditorView) => boolean`。返回 true = 已处理,false = 让默认 keymap 接手。

```ts
// 示例:Ctrl+B
const toggleBold: Command = (view) => {
  const sel = view.state.selection.main
  const text = view.state.sliceDoc(sel.from, sel.to)
  const wrapped = `**${text}**`
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: wrapped },
    selection: { anchor: sel.from + 2, head: sel.from + 2 + text.length }
  })
  return true
}
```

### 拖图设计

- drop 事件:event.dataTransfer.files → 取 image/* 文件
- 用 FileReader 读 base64
- 调 `invoke("write_binary_file_absolute_base64", { path: targetAbsPath, base64Content })` 写盘
- 计算相对当前 .md 文件目录的路径
- dispatch insert `![](relativePath)` 到光标位置

**目标存盘路径**:同当前 .md 文件目录,文件名 `pasted-{timestamp}.{ext}`(避免文件名冲突)。后续可加 Attachments/ 子目录约定,v1 先放同目录最简单。

### 双提示框 fix

当前 dirtyConflict toast 用 `showToast({ ... })` 没 id,无法 dismiss。修法:
- 在 `notifyDirtyConflict` 给 toast 加 id `dirtyConflict:<path>`
- 在 file-tabs.tsx `saveEdit` 成功分支调 `dismissToast(id)`

需要看 toast 系统是否支持 `dismiss(id)`。如不支持,给现有 toast hook 加一个。

## R1-R4 合规

| 规则 | 评估 |
|---|---|
| **R1**(三级跳) | 主要走第 1 档:fork-only 新文件(`markdown-editor-extensions.ts`)+ 上游已 fork 改造区(`file-tabs.tsx` / `code-mirror-view.tsx` / `context/file.tsx`)延伸 |
| **R2**(FORK marker) | 改 code-mirror-view.tsx / file-tabs.tsx / context/file.tsx 加 marker;新文件无需 |
| **R3**(品牌 hardcode) | 不触发 |
| **R4**(黑名单 override) | `packages/app/` 不在黑名单,本笔**0 R4 override**。这是相比 md-office-improvements 大改观 — 编辑器全在 app 层 |

## 工程量预估

| Phase | 工作量 |
|---|---|
| 加 dep + code-mirror-view.tsx 扩展 prop + Ctrl+F 接入 | 0.2d |
| 表 1 — 列表续延 + Ctrl+B/I/K + 拖图 + 双提示 fix | 0.85d |
| 表 2 — 5 项加分 | 0.55d |
| typecheck + build + 三文档 | 0.3d |
| **总** | **~1.9 工作日 / AI 辅助 2-3 小时** |

## 验收标准

### 表 1
- [ ] A1.1:`- ` 行 Enter 自动续 `- `,空 item 再 Enter 退出
- [ ] A1.2:`1. ` 行 Enter 自动续 `2. `(数字递增)
- [ ] A1.3:`- [ ] ` 行 Enter 自动续 `- [ ] `
- [ ] A1.4:Ctrl+B 选区包 `**...**`,选区空时插光标 `**|**`
- [ ] A1.5:Ctrl+I 包 `_..._`
- [ ] A1.6:Ctrl+K 包 `[选中](|)` 光标到括号内
- [ ] A1.7:OS 拖图进编辑器 → 同目录 `pasted-N.png` + 光标位置 `![](pasted-N.png)`
- [ ] A1.8:Ctrl+V 粘贴剪贴板图(Win 截图后) → 同 #7
- [ ] A1.9:保存后只剩 1 条 "Saved" toast,dirtyConflict toast 自动消失

### 表 2
- [ ] A2.1:Ctrl+Enter 在 `- [ ]` 行切 `- [x]`,反之亦然
- [ ] A2.2:`> ` 行 Enter 自动续 `> `
- [ ] A2.3:H2/H3 段左侧出现折叠箭头,点击折叠
- [ ] A2.4:选中文字后 Ctrl+V 粘贴 URL → 自动 `[选中](URL)`
- [ ] A2.5:在表格 cell 内 Tab 跳到下个 cell

### Ctrl+F / 不回归
- [ ] A3.1:Ctrl+F 弹搜索面板,正则 / 大小写 / 选区内全可用
- [ ] A3.2:Ctrl+H 弹替换面板
- [ ] R1.1:聊天侧 markdown 渲染不变(无 editor 影响)
- [ ] R1.2:Save 仍走 mtime 冲突 / readonly / binary / 大文件防呆
- [ ] R1.3:typecheck 15/15
- [ ] R1.4:DeskFox.exe build size 增长 < 500KB(主要 search 包 + 自写代码)

## 关联清理

| 需求 | 处理 |
|---|---|
| 主索引"obsidian 的 md 编辑体验,要不要支持" | 完成后改 `[x]` 移到 done section |
| 主索引"修改文档保存后出现两个提示框" | 同上 |
| `保存后双提示框.md` | 标 done,链回本 spec |
| `保存后提示优化.md` | 标 done(方案 A 落地)|
| `obsidian-md编辑体验.md` | 标 done(D1=B + Tier B + 表 1+2 + Ctrl+F) |

## 决策签字

- **2026-05-05** user 答 D1=B / D2=Tier B 全套 + Ctrl+F / D3=A 双模式按钮 / D4=A 显式 Save → spec 锁版
- 实施期间 scope 偏移 → 在 `2-plan.md` 实时记
