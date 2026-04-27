---
feat-id: file-tree-dnd
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 文件树拖放移动 — spec

## 触发原因

DeskFox 右侧文件树(`packages/app/src/components/file-tree.tsx`)目前只能**发起**拖拽(用作把文件路径塞进聊天/编辑器),不能**接收** drop。这是 file explorer 类组件最高频的交互之一,缺失明显。

底层惊喜:`rename_path` Tauri 命令 = `std::fs::rename`,跨目录改路径就是 OS 层 move。**0 后端开发**就能支持移动。

## 用户决策(2026-04-27)

- **范围**:全功能(含进阶) — 核心 + 多选 + Ctrl+Z 撤销 + 外部文件拖入 + 剪切/粘贴菜单 + 快捷键
- **确认对话框**:**永不弹** + Ctrl+Z 兜底
- **同名冲突**:**自动加后缀 `-1`** 再 rename(类系统资源管理器)

## 验收标准

### 核心

- [ ] T1 拖文件 `a/x.txt` 到 `b/` → 移动到 `b/x.txt`
- [ ] T2 同名 → 自动后缀 `x-1.txt` / `x-2.txt`
- [ ] T3 拖父进子 → 静默拒绝
- [ ] T4 拖到自身 / 已在目标目录 → no-op
- [ ] T5 hover 折叠文件夹 600ms → spring-load 自动展开
- [ ] T10 拖动时源行 opacity 50%,hover 目标 folder 时 outline ring,拖出 viewport 反馈消失

### 多选

- [ ] T6a Ctrl+click 选 3 个 → 拖第一个 → 全部移动
- [ ] T6b Shift+click 范围 → 拖 → 全部移动

### 剪切/粘贴

- [ ] T7a Ctrl+X 剪切 → 视觉 opacity-60 → Ctrl+V 粘贴目标 → 移动
- [ ] T7b Ctrl+C 复制 → Ctrl+V → 复制(原文件保留)

### Undo

- [ ] T8a 任何 move/copy 后 Ctrl+Z → 撤销
- [ ] T8b 连续 5 次 move 后 5 次 Ctrl+Z → 完全撤回

### 外部拖入

- [ ] T9a 从 Windows Explorer 拖 1 个文件到树某文件夹 → 复制进去(原文件不动)
- [ ] T9b 拖多个文件 → 全部进去,冲突自动后缀

### 错误处理

- [ ] T11 跨设备 move 失败(D:\ → C:\) → toast 错误,不做 fallback(已知限制)

## 不做什么

- ❌ drop file 上传到聊天(另一个 feature)
- ❌ drag tab 到文件树
- ❌ Undo 持久化(in-memory 即可)
- ❌ 拖动时浮动 tooltip "将移动 N 个文件"(v2 优化)
- ❌ 跨设备 move 的 copy+delete fallback

## 架构选型

复用 `rename_path` Tauri 命令做 move(零后端开发)。新增 `copy_path` 用于复制粘贴模式。selection / clipboard / undo 都是 fork-only 新文件,不动上游 store。外部文件拖入走 Tauri WebviewWindow `onDragDropEvent`,通过 `branding/tauri-overrides/*.json` 注入 `dragDropEnabled: false`(避免触发 tauri.conf.json 黑名单 override)。

## 复用现有

| 函数 / 接口 | 位置 | 复用为 |
|---|---|---|
| `invoke("rename_path")` | Tauri | move 主操作 |
| `invoke("trash_path")` | Tauri | undo "copy" 类反向删除 |
| `withFileDragImage` | file-tree.tsx | 多选时叠加显示 |
| `file.tree.refresh(path)` | context/file.tsx | 操作完成后刷新 |
| `file.tree.expand(path)` | 同上 | spring-load |
| `useDialog` / `showToast` | @opencode-ai/ui | 反馈 |
| `basename` / `dirname` / `joinAbs` | file-tree.tsx 内部 | 路径计算 |

## 详细 plan

见 `2-plan.md`。
