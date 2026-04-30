---
feat-id: 加聊天-option-enter
status: done
related: ./3-changelog.md
---

# 加聊天-option-enter — changelog

**关联 commit**: 待回填
**所在分支**: `feat/editable-file-viewer`
**规模**: Tiny(14 行 / 1 文件,无 1-spec / 2-plan)
**触发原因**: User 在 macOS 上用文件查看器右键"+ 添加到聊天窗口"打开备注输入框,习惯按 Option+Enter 提交(macOS 下许多对话框的常见快捷键),实际只识别 Ctrl/Cmd+Enter。需要补 Option+Enter 通道,并把对话框底部提示文案做平台化。

## 实际改动

### `packages/app/src/pages/session/file-tabs.tsx`(+9 / -5)

- 加平台检测常量 `IS_MAC = /mac/i.test(navigator.platform)`(文件顶部模块作用域,FORK marker 标注用途)
- 备注 textarea 的 `onKeyDown` 改造:
  - 提前 return 非 Enter 键
  - 提交条件由 `e.ctrlKey || e.metaKey` 扩成 `e.ctrlKey || e.metaKey || (IS_MAC && e.altKey)`
  - macOS 下 Option(`altKey`)+Enter 也走 `submitMdSelection()`
- 底部提示文案平台化:
  - macOS 显示 `Cmd/Opt+Enter 提交 · Esc 取消`
  - Win/Linux 显示 `Ctrl+Enter 提交 · Esc 取消`(原文案)

## 行数

| 项 | 行数 |
|---|---|
| `file-tabs.tsx` insertions | 9 |
| `file-tabs.tsx` deletions | 5 |
| 净 | +4 |

Tiny 级,远在 500 阈值内。无 large-diff,无 override。

## 影响范围

- ✅ macOS:Option+Enter / Cmd+Enter / Ctrl+Enter 三种快捷键都能提交备注;底部文案显示 Cmd/Opt+Enter
- ✅ Windows / Linux:行为不变,Ctrl+Enter 提交,文案保持 `Ctrl+Enter 提交 · Esc 取消`
- ✅ Esc 取消路径未动
- ✅ 非 Enter 键直接 return,不进入修饰键判断分支(微优化,行为不变)
- ✅ 与 `加聊天-preview-fix`(synthetic text + preview)/ `macos-右键选区-修复`(选区捕获 + overlay)链路兼容,本 feat 仅触动 `submitMdSelection` 的触发判定,不动选区/preview

## 回归测试点

User 在 macOS release raw binary(`packages/desktop/src-tauri/target/release/DeskFox`,`build-deskfox.sh -Env dev --no-bundle`)实测:

- **R1** 选中文字 → 右键 → "+ 添加到聊天窗口" → 对话框底部文案为 `Cmd/Opt+Enter 提交 · Esc 取消` → ✅
- **R2** 输入文字 → 按 **Option+Enter** → 提交成功 → ✅(主功能)
- **R3** 输入文字 → 按 **Cmd+Enter** → 提交成功 → ✅(原行为保留)
- **R4** 输入文字 → 按 **Ctrl+Enter** → 提交成功 → ✅(原行为保留)
- **R5** 按 **Esc** → 取消(关闭菜单 + 清选区)→ ✅(未动)

## review 自检

- [x] 仅触动 fork 白名单文件(`packages/app/src/pages/session/file-tabs.tsx` 已是 fork-heavy)
- [x] 改动无逻辑回归点 — 提交条件是"或"扩展,原 Ctrl/Cmd 路径不动
- [x] FORK marker 已加(模块顶部 IS_MAC 常量 + onKeyDown 内修饰键判断)
- [x] 无新增依赖
- [x] typecheck 全过(14/14)
- [x] release raw binary 实测过(memory 提醒:`--no-bundle` 不更新 .app,所以走 raw binary 验证而非 .app)

## 回退方法

```
git revert <code commit hash>
```

单文件 14 行,无 schema / 无服务端 / 无依赖,直接 revert。

## 备注

- 选 `altKey` 不选 `e.code === "AltLeft" || "AltRight"`:`altKey` 是修饰键标志,不区分左右 Alt,而 macOS 上 Option = Alt,系统层只暴露 `altKey`,与意图一致。
- 仅 macOS 启用 Option+Enter:Win/Linux 上 Alt+Enter 通常被 OS / 应用窗口快捷键占用(如 Alt+Enter 全屏、属性窗口),贸然加会撞键。
