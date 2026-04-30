---
feat-id: file-tree-dnd
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./4-test-checklist.md
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

> 全部条目详见 `4-test-checklist.md`(完整 32 条 7 组),user 已逐项手测通过(2026-04-27 → 28)。
> 下表是 spec 级别的关键路径概览。

### 核心拖放(A 组)

- [x] T1-T5 跨目录拖、同名自动后缀、cycle 拒绝、no-op、spring-load
- [x] T10 视觉(源行半透明 / 目标 ring / 根淡蓝)
- [x] T11 跨设备 move 错误 toast(已知限制,不做 copy+delete fallback)

### 多选(B 组)

- [x] T6 全套(Ctrl/Shift+click + 整组拖动 + 视觉区分)

### 剪切/粘贴(C 组)

- [x] T7 全套(Ctrl+X/C/V + 右键菜单粘贴 + 同名后缀 + 不抢编辑器快捷键 + 选文件夹粘进去 + 选文件粘到同级)

### 右键 OS-like(D 组)

- [x] D1-D3 右键自动 replace selection / 多选保持 / 批量删除对话框

### Undo(E 组)

- [x] T8a-c move/copy 撤销 + 连续撤销

### 外部 OS 文件拖入(F 组)

- [x] T9a-c 单文件 / 多文件 / 拖到根 → 复制成功
- [x] T9d chat 输入框拖入仍走 attachments(没被文件树抢)
- ⚠️ 不支持文件夹拖入(HTML5 dataTransfer.files 不递归子项)

### 回归(G 组)

- [x] R1-R5 原打开文件 / 展开 / 右键菜单 / 状态保持 / 多 provider 切换

## 不做什么

- ❌ drop file 上传到聊天(另一个 feature)
- ❌ drag tab 到文件树
- ❌ Undo 持久化(in-memory 即可)
- ❌ 拖动时浮动 tooltip "将移动 N 个文件"(v2 优化)
- ❌ 跨设备 move 的 copy+delete fallback

## 架构选型(最终落地)

### 移动 / 复制后端
- **复用 `rename_path` Tauri 命令做 move**(零后端开发,std::fs::rename 跨目录就是 OS 层 move)
- **新增 `copy_path` 命令**(含 `copy_dir_recursive` 助手做递归目录复制)
- **新增 `next_available_path` 命令**:Rust 端一次性算出不冲突路径(替代 JS 多次 exists_path 调用,避免 `\` vs `/` path 分隔符歧义 — 路径分隔符问题踩过坑,详见 plan D4)
- **新增 `exists_path` 命令**(commit #1 加,仅供少数场景);**新增 `write_binary_file_absolute_base64` 命令**(commit #4 给外部文件 drop 用,见下)

### 前端状态分离
- selection / clipboard / undo-stack 三个 store 都是 **fork-only 新文件**,放 `packages/app/src/context/file/`,挂到 `useFile()` 返回值
- 不动上游 `tree-store.ts` 的核心结构(只补一处 `force=true` 真生效的 fix)

### 外部 OS 文件拖入(走 FileReader)
- ❌ **第一版方案被推翻**:Tauri WebviewWindow `onDragDropEvent` API 实测在本环境不工作(原因未定位,可能 capability/版本/dragDropEnabled 配置交互),也试过把 `dragDropEnabled: false` 注入 `branding/tauri-overrides/*.json` 让 webview 直接收 HTML5 drop — 但 webview 给的 File 对象**没有** `.path` 字段(Windows WebView2 安全策略),拿不到 OS 文件绝对路径
- ✅ **最终方案**:走 HTML5 drop event(Tauri 默认配置即可,不动 dragDropEnabled)→ `dataTransfer.files` 拿 File 对象 → `FileReader.readAsDataURL` 读成 base64 → invoke 新 Rust 命令 `write_binary_file_absolute_base64` 写盘
- 副作用:文件夹拖入不支持(HTML5 不递归子项),v1 接受这个限制
- 决策轨迹详见 `2-plan.md` D8

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

见 `2-plan.md`(实施步骤 + 决策轨迹 + 踩坑) / `3-changelog.md`(实际 commit 列表 + 文件级行数 + 验收) / `4-test-checklist.md`(完整 32 条测试)。
