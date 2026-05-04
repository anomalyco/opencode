---
feat-id: viewer-ctrlc-fix
status: done
related: ./3-changelog.md
---

# 文件查看器 Ctrl/Cmd+C 修复(shadow DOM 路径)

## 需求来源

`OPENCODE-PLAN/DeskFox.Ai 需求池.md` MD 段 #14:
> 文件查看器:Ctrl+C 复制只在 MD 文档生效,其他能选中文字的格式(office / PDF / HTML 预览 / 代码文件等)右键菜单"复制"可用,但键盘 Ctrl+C 没反应。注:与既有 ctrl-c-复制失效.md(文件树 hook 抢占)是不同 bug

## 根因

文件查看器 3 条渲染路径:
- `.md` → `<Markdown>` 组件,**light DOM** 渲染
- 媒体 → `<audio>/<video>`,N/A
- **其他(代码/HTML/PDF/office 预览)→ `@pierre/diffs` 的 `<diffs-container>`,内容在 shadow DOM 里**

WebView2(Chromium)和 macOS WebKit 的**原生 Ctrl+C** 都通过 `window.getSelection().toString()` 取要复制的文本。对 shadow DOM 内容,这个调用返回**空字符串** → 系统剪贴板拿不到东西 → "Ctrl+C 没反应"。

但**右键菜单"复制"**能用,因为已有的 `handleSelectionContextMenu`(line 849)走的是仓内 2026-04-29 macOS 选区修复时建立的 `pickBestRecentSelection()` 机制——shadow-aware 的选区历史栈,通过 `getComposedRanges({ shadowRoots })` API 跨 shadow 边界拿到真实文本。

## 解法

复用同一套 `pickBestRecentSelection()`,在 file-tabs.tsx 加一个 **window-capture-phase keydown handler**(对仗 line 605 既有的 Ctrl+F handler),Ctrl/Cmd+C 时直接拿"最近最长选区"text 写入 `navigator.clipboard`,`preventDefault()` 阻断原生失败路径。

让路条件(走原生):
- 编辑态(CodeMirror 自管 Ctrl+C)
- 焦点在 input / textarea / contenteditable(自有 selection,不应被覆盖)
- 选区历史空 / 文本为空(no-op,与原生一致)

## 影响范围

- **修复**:代码 / 文本 / HTML 等**可选中文本**且走 `@pierre/diffs` shadow DOM 渲染的类型 — `.py / .ts / .tsx / .html / .css / .json / .go / .rs / .java / .c / .cpp / .sh / .xml / .sql / .yaml / .toml / .txt` 等。Ctrl+C 现在直接生效
- **不在本修复范围 — PDF / `.docx` / `.xlsx` / `.pptx` 预览**:2026-05-04 user 实测确认这些查看器**文本本就不可选**(office 预览经 LibreOffice → PDF + pdfjs 渲染但文本层未开 / 图像化预览),Ctrl+C 问题在那儿不存在,所以与本修复无关。**未来若**这些查看器开放选区,本修复机制自动适用(都走同一 window-capture keydown 路径,无需再改)
- **不回归**:.md(light DOM 选区也进 history,picker 同样拿到 → writeText 与原生等效)
- **不影响**:聊天输入框 / 重命名 dialog 等输入框(被 input/textarea/contenteditable guard 让路)
- **不影响**:文件树自身 Ctrl+C 复制路径(file-tree.tsx 的 `useFileTreeShortcuts`,走另一条 hook 链,继续用 `filetree-ctrlc-textsel-fix` 后的逻辑)

## 文件改动

| 文件 | 改动 |
|---|---|
| `packages/app/src/pages/session/file-tabs.tsx` | 加一个 createEffect + window-capture keydown(36 行 FORK 块,line ~621-655) |

## 验证

- ✅ `bun run typecheck` 15/15 全过
- ✅ `build-deskfox.ps1 -Env dev -NoBundle` 成功:DeskFox.exe 32.24 MB / 1m09s / exit 0
- ✅ user 2026-05-04 runtime 实测:**非 .md 文件 Ctrl+C 复制问题已处理**(代码文件 / HTML / 纯文本 等 shadow DOM 类型);PDF / Office 因文本不可选,本就不在 bug 范围,无需测试

## R2 / R3 / R4 合规

- **R2**:加了 `// FORK-BEGIN: ... 2026-05-04` ... `// FORK-END` 块包住 36 行新增
- **R3**:不涉及主题/品牌/icon
- **R4**:fork-only 文件 `packages/app/src/pages/session/file-tabs.tsx`(本就 fork 改造重灾区,不在黑名单);0 R4 override
- **diff 阈值**:36 行 << 500,Tiny 规模
- **三文档**:Tiny 规模只 changelog(本笔),省 1-spec / 2-plan(原始 bug 报告在需求池 #14 + 已展开评估 ctrl-c-复制失效.md 的姐妹文档背景里)

## 回退

```
git revert <commit-hash>
```

或 cherry-pick 撤回:删 file-tabs.tsx 的 36 行 FORK 块即可(仅追加,无改动既有逻辑)。回退后非-md viewer 的 Ctrl+C 回到失效状态,右键复制仍可用。

## 关联

- **2026-04-29 `macos-右键选区-修复`**:建立 `pickBestRecentSelection` + `getComposedRanges` 机制(本次直接复用)
- **2026-05-04 `filetree-ctrlc-textsel-fix`**:不同 bug — 文件树 hook 抢键盘;本次不涉及那个代码路径
