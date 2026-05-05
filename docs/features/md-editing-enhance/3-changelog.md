---
feat-id: md-editing-enhance
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 改动日志

## commit

待 commit hash 填回(单笔 commit + docs 收尾笔)。

## 文件改动总览

| 文件 | 性质 | 改动量 |
|---|---|---|
| `packages/app/package.json` | 修改 | +1 行(`@codemirror/search` 6.5.11) |
| `packages/app/src/utils/markdown-editor-extensions.ts` | **新文件** | ~290 行(11 项 markdown 命令集合) |
| `packages/app/src/components/code-mirror-view.tsx` | 修改 | +5 行(extraExtensions prop) |
| `packages/app/src/pages/session/file-tabs.tsx` | 修改 | +20 行(import + extension 注入 + 3 处 dismissDirtyConflict 调用) |
| `packages/app/src/context/file.tsx` | 修改 | +30 行(toast id Map + dismissDirtyConflict + 暴露给上层) |
| `bun.lock` | auto-regenerated | +几行 transitive deps |
| `docs/features/md-editing-enhance/{1-spec,2-plan,3-changelog}.md` | 新 | ~700 行三文档 |
| `docs/features/INDEX.md` | 修改 | +1 行 |
| `改动日志.md` | 修改 | +1 行 |

**净代码 ~340 行**(不含 docs / lock)。**Medium 规模**,单一主题。

## 11 项 scope 落实

### 表 1 — 4 项核心(P0)

| # | 项 | 实现 |
|---|---|---|
| A1.1-A1.3 | 列表续延(`-` / `1.` / `- [ ]`)+ 块引用 `>` | 自写 `continueListCommand`,4 个正则按优先级匹配,空 item Enter 退出 |
| A1.4-A1.6 | Ctrl+B / Ctrl+I / Ctrl+K | `makeWrapCommand` factory,3 个 commands;Ctrl+K 光标进 `()` 等待输入 url |
| A1.7-A1.8 | 拖图 / 截图粘贴 | `EditorView.domEventHandlers({ drop, paste })`;FileReader → base64 → invoke `write_binary_file_absolute_base64` → dispatch insert `![](filename)`;同当前 .md 文件目录,文件名 `pasted-{timestamp}-{name}` |
| A1.9 | 修保存后双提示框 bug | file.tsx 加 `dirtyConflictToastIds` Map 跟踪 toast id;saveEdit 成功后调 `file.dismissDirtyConflict(p)` 清掉。同 path 重复 notify 时也 dismiss 旧的(防叠加)|

### 表 2 — 5 项加分(P1)

| # | 项 | 实现 |
|---|---|---|
| A2.1 | Ctrl+Enter 切 `[ ]` ↔ `[x]` | `toggleTaskCheckCommand`,匹配 task pattern 替换 `[ ]` 字符 |
| A2.2 | 块引用 `>` 续延 | 复用 `continueListCommand`,LIST_PATTERNS 第 4 条 |
| A2.3 | Heading 折叠 | `foldGutter()` extension(lang-markdown 已带 fold support 自动激活)+ `foldKeymap`(Ctrl+Shift+[/]) |
| A2.4 | 智能 URL 粘贴 | paste handler 内 `handlePasteHook`:选区非空 + 剪贴板是 http(s) URL → 改写 `[选中](URL)` |
| A2.5 | 表格 Tab 跳格 | `tableTabCommand`:行内含 `|` 且光标后还有 `|` → 跳到下个 `|` 后第一个非空格;否则 false 让默认 Tab 走 |

### Ctrl+F 即插

| 项 | 实现 |
|---|---|
| Ctrl+F 搜索 / Ctrl+H 替换 | `import { search, searchKeymap } from "@codemirror/search"` 直接 + `extensions: [..., search(), keymap.of(searchKeymap)]`。完整面板:正则、大小写、选区内查找、替换全部到位 |

## R4 override

**0 笔**。所有改动都在 `packages/app/`(非黑名单)。

## 验证

### 自动化 ✅

- typecheck:15/15(8.682s)
- DeskFox.exe build:34.79 MB / 2m16s / exit 0(+40KB,主要是 @codemirror/search 包)

### Runtime(待 user 实测)

| 类 | 数 | 内容 |
|---|---|---|
| 表 1 | A1.1-A1.9(9 项) | 列表续延 / Ctrl+B/I/K / 拖图截图 / 双提示 fix |
| 表 2 | A2.1-A2.5(5 项) | 任务勾选 / 块引用 / 折叠 / URL 粘贴 / 表格 Tab |
| Ctrl+F | A3.1-A3.2(2 项) | 搜索 / 替换面板 |
| 不回归 | R1.1-R1.4(4 项) | 聊天 markdown / Save 防呆 / typecheck / build size |

详细 acceptance 见 1-spec.md "验收标准" 段。

## 关联清理(完成后做)

| 需求池条目 | 处理 |
|---|---|
| 主索引"obsidian 的 md 编辑体验,要不要支持" | `[x]` 移到 done section |
| 主索引"修改文档保存后出现两个提示框" | `[x]` 移到 done section |
| `obsidian-md编辑体验.md` | status 改 done,链回本 spec |
| `保存后双提示框.md` | status 改 done,合并 fix 注释 |
| `保存后提示优化.md` | status 改 done(方案 A 落地)|

## 回退

```
git revert <commit>
```

或 cherry-pick 撤回:
- 删 `packages/app/src/utils/markdown-editor-extensions.ts`(新文件)
- code-mirror-view.tsx 撤 `extraExtensions` prop
- file-tabs.tsx 撤 import + `extraExtensions` 注入 + 3 处 `dismissDirtyConflict` 调用
- file.tsx 撤 `toaster` import + `dirtyConflictToastIds` Map + `dismissDirtyConflict` 函数 + 返回值导出
- packages/app/package.json 撤 `@codemirror/search` dep + `bun install`

## 关联

- **吸收的需求池条目**:
  - `obsidian-md编辑体验.md` — 调研论证 → D1=B / D2=Tier B 全套 / D3=A / D4=A
  - `保存后双提示框.md` — fix 落地(同 toast dismiss 方案)
  - `保存后提示优化.md` — 方案 A 落地
- **未来衔接**:
  - 表格 v2:Enter 加新行 + 自动对齐管道符(独立工程量)
  - 拖图 Attachments/ 子目录约定(可选)
  - `@codemirror/autocomplete` 框架 — 若以后做 emoji / heading 跳转补全直接接入
