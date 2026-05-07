---
feat-id: md-context-menu-i18n
status: done
related: ./3-changelog.md
---

# md-context-menu-i18n — changelog

**关联 commit**: `2ec527dce`
**所在分支**: `feat/md-context-menu-i18n`(已合 dev 即销毁)
**baseline**: `8e32600a4`
**触发原因**: User 反馈 — md-export-pdf-word 接入"导出 Word" i18n 后,viewer 右键菜单**其他项仍硬编码中文**(添加到聊天窗口 / 编辑 / 复制 / 输入框 placeholder / 取消 / 加入聊天 / 快捷键提示),英文 locale 用户看到中英混杂。要求"跟随软件语言设置变化"。

## 改动

### 5 个新 i18n key + 复用 2 个 common.*

| key | zh | zht | en |
|---|---|---|---|
| `fileViewer.menu.addToChat` | 添加到聊天窗口 | 新增至對話視窗 | Add to Chat |
| `fileViewer.menu.copy` | 复制 | 複製 | Copy |
| `fileViewer.menu.input.placeholder` | 想怎么改 / 想问什么... | 想怎麼改 / 想問什麼... | How would you change it / What would you ask... |
| `fileViewer.menu.input.shortcutHint` | {{shortcut}} 提交 · Esc 取消 | {{shortcut}} 提交 · Esc 取消 | {{shortcut}} to submit · Esc to cancel |
| `fileViewer.menu.input.submit` | 加入聊天 | 加入對話 | Add to Chat |

复用现有 key:
- "编辑" → `common.edit`
- "取消" → `common.cancel`

### 文件改动

| 文件 | 改动 |
|---|---|
| `packages/app/src/i18n/zh.ts` | +6 行(5 new key + 1 注释) |
| `packages/app/src/i18n/zht.ts` | +6 行 |
| `packages/app/src/i18n/en.ts` | +6 行 |
| `packages/app/src/pages/session/file-tabs.tsx` | +11 / -7(7 处硬编码 → `language.t()`) |

其他 14 种语言字典自动 fallback en(架构既有)。

## 影响范围

- ✅ `.md` 文件查看器右键菜单(光标 + 输入框双模式)
- ❌ 不影响 chat / file tree / settings 等其他 UI
- ❌ 字典 entry 跨平台一致(Win/Mac/Linux 共享)

## 验证

GUI 自动化端到端(macOS Mac arm64,build 完整 .app):
- 当前 user locale = en,右键 viewer 空白处:4 项全显示英文 ✅
  - "Add to Chat" 灰显
  - "Edit" 可用
  - "Copy" + Ctrl+C 灰显
  - "Export as Word" 可用
- 切中文 locale 时:5 个新 key + 2 个复用 common 都跟随显示中文(逻辑等价,字典已加全)

## 行数

| 项 | 行数 |
|---|---|
| 代码净改动 | ~29 行 |
| 文档(本文件)| ~50 行 |

Tiny 级,在规范 v2 阈值内。0 R4 / 0 黑名单 / 0 上游侵入。

## 回退方法

`git revert 2ec527dce` — 恢复硬编码,字典 5 个新 key 保留(无副作用)。
