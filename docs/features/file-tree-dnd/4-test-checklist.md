---
feat-id: file-tree-dnd
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./4-test-checklist.md
---

# 文件树拖放移动 — 验收清单

> 每次 build 出新 DeskFox.exe 后,对照本清单逐项过一遍。
> 列出场景 + 操作 + 期望结果。✅ / ❌ 自己标。
>
> Build 命令:
> ```powershell
> Get-Process -Name DeskFox,OpenCode,opencode-cli,opencode-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
> D:\project\opencode-fork\packages\branding\scripts\build-deskfox.ps1 -Env dev -NoBundle
> ```
>
> exe 路径:`D:\project\opencode-fork\packages\desktop\src-tauri\target\release\DeskFox.exe`

## A. 拖放核心(commit #1)

| # | 操作 | 期望 |
|---|---|---|
| **T1** | 拖文件 `a/x.txt` 进文件夹 `b/` | `b/x.txt` 出现,`a/` 下消失 |
| **T2** | `b/` 已有 `x.txt`,再拖一个同名进去 | 自动改名 `x-1.txt`;再拖第三个 → `x-2.txt` |
| **T3** | 拖文件夹 `a/` 进自己的子目录 `a/sub/` | 静默拒绝(无变化、无 toast) |
| **T4a** | 拖文件到自身所在目录 | 静默 no-op |
| **T4b** | 拖文件到自身 | 静默 no-op |
| **T5** | 拖文件 hover **未打开过 / 已折叠**的文件夹,停 600ms | 自动展开 |
| **T10a** | 拖动时被拖的源行 | opacity 50% 半透明 |
| **T10b** | hover 目标文件夹 | 蓝色 outline ring |
| **T10c** | 拖到根空白区 | 整个根区域淡蓝 |
| **T10d** | 拖出文件树外(chat 输入框)放下 | 像之前一样 @-mention 该文件 |
| **T11** | 跨设备 move(D:\ → C:\folder\,如能复现) | toast 错误提示,不静默失败 |

## B. 多选(commit #2)

| # | 操作 | 期望 |
|---|---|---|
| **T6a** | Ctrl+click 选 3 个文件 → 拖第一个 | 三个都移动 |
| **T6b** | Shift+click 选范围 → 拖 | 范围内全部移动 |
| **T6c** | Shift / Ctrl click | **不打开文件 / 不展开目录**(只做选择) |
| **T6d** | 选中多个后开始拖 | 所有源行都 opacity-50 半透明 |
| **T6e** | 普通单 click | selection 重置为该单个,正常 open file / expand folder |
| **T6f** | 选中行视觉 | 有 ring 边框(与 active 文件的 filled bg 高亮不同) |
| **T6g** | 拖**未选中**的文件(selection 在别处) | 只拖该一个,selection 不被覆盖 |

## C. 剪切/粘贴/复制(commit #3)

| # | 操作 | 期望 |
|---|---|---|
| **T7a** | 选 1-2 个 → Ctrl+X 剪切 → 行变 opacity-60 + italic → 右键文件夹"粘贴到此文件夹"或 Ctrl+V | 移动 + 视觉恢复 + clipboard 清空 |
| **T7b** | Ctrl+C 复制 → 右键文件夹"粘贴到此文件夹" | 复制(原文件保留),可继续粘到别处(clipboard 不清) |
| **T7c** | 复制目录(含子文件夹)→ 粘贴 | 整个递归复制 |
| **T7d** | 同名冲突 | 自动后缀 `-1` |
| **T7e** | 在编辑器 / 输入框聚焦时 Ctrl+X/V | **不**触发文件树剪切(不抢编辑器快捷键) |
| **T7f** | 右键根空白区 + clipboard 非空 | 显示"粘贴到项目根" |
| **T7g** | cut 后剪切到自己当前所在目录 | 静默 no-op(cycle 检测) |
| **T7h** | 同目录 Ctrl+C → Ctrl+V | 创建副本 `-1` 后缀(copy 同目录是合理操作) |
| **T7i** | 选中**文件** + Ctrl+V | 粘到该文件的同级目录(不是根) |
| **T7j** | 选中**文件夹** + Ctrl+V | 复制到该文件夹**内** |
| **T7k** | 右键文件 → 菜单显示"粘贴到当前目录" | 粘到该文件的同级目录 |
| **T7l** | 右键文件夹 → 菜单显示"粘贴到此文件夹" | 粘到文件夹内 |

## D. 右键 OS-like(commit #3 Bug fix)

| # | 操作 | 期望 |
|---|---|---|
| **D1** | 右键**未选中**的行 | selection 自动 replace 为该行(其他行 ring 消失) |
| **D2** | 右键**已多选**之一 | 多选保持(菜单作用于整组) |
| **D3** | 多选后右键删除 | 弹"批量删除 N 个项目"对话框 → 确认 → 全删 |

## E. Undo(commit #4)

| # | 操作 | 期望 |
|---|---|---|
| **T8a** | 任何 move 后 → Ctrl+Z | 文件回到原位 |
| **T8b** | 任何 copy 后 → Ctrl+Z | 副本被 trash(移到回收站) |
| **T8c** | 连续 5 次操作 → 连按 5 次 Ctrl+Z | 全部撤回 |

## F. 外部 OS 文件拖入(commit #4)

| # | 操作 | 期望 |
|---|---|---|
| **T9a** | 从 Windows Explorer 拖**1 个**文件到树某文件夹 | 复制进去(原 OS 文件不动) |
| **T9b** | 拖**多个** OS 文件 | 全部进去,同名冲突自动 `-1` |
| **T9c** | 拖 OS 文件到树根空白区 | 复制到项目根 |
| **T9d** | 在 chat 输入框上拖 OS 文件 | 仍走 attachments.ts 的 @-mention(没被文件树抢) |

## G. 回归 — 不应被打破

| # | 操作 | 期望 |
|---|---|---|
| **R1** | 普通点击文件 | 打开文件到右侧编辑器 |
| **R2** | 普通点击文件夹 | 展开/折叠 |
| **R3** | 右键菜单的重命名 / 在文件夹中显示 / 打印 / 删除 / 新建文件 / 新建文件夹 | 全正常 |
| **R4** | 文件树状态(展开/折叠 / 哪些已打开) | 重启后保持 |
| **R5** | 多 provider / Tab / Session 切换 | 文件树正常显示当前 project |

## 已知限制(不视为 bug)

- 跨设备 move(`D:\file.txt → C:\folder\`):`std::fs::rename` 失败 → toast 报错,不做 copy+delete fallback(v2)
- Undo 仅 in-memory,重启失效(v2 可考虑 localStorage 持久化)
- 拖动浮动 tooltip "将移动 N 个文件"未做(v2 UX)

## 反馈格式

测完直接列出"过/挂/有疑问"三类,每类列出条目编号 + 一句现象。例:
- ✅ 过:T1, T2, T3, T6a-g
- ❌ 挂:T9a — 拖外部文件显示 + 但实际没复制
- ❓ 疑问:T8c — 撤销第 3 次后页面有抖动,不确定是否预期
