---
feat-id: menu-always-show-with-disabled
status: done
related: ./3-changelog.md
---

# menu-always-show-with-disabled — changelog

**关联 commit**: `c25214889`
**所在分支**: `feat/menu-always-show-with-disabled`(已合 dev 即销毁)
**baseline**: `23dfc0e0b`
**触发原因**: User 反馈 — `.md` 文件查看器右键菜单当前两套(选了文字 4 项 / 没选 1 项),希望**始终显示 4 项**,选区相关项灰显 disabled。一致 UX:user 一眼看到全部能做的事,不用先选文字才知道有"导出 Word"。

## 改动

### `packages/app/src/pages/session/file-tabs.tsx`(+34 / -46)

去掉 `<Show when={mdMenu().text.trim()} fallback={...}>` 包裹,4 个 button 始终 render:
- **添加到聊天窗口**:`disabled={!mdMenu().text.trim()}` 灰显
- **编辑**:`disabled={!canEdit() || !state()?.loaded}` 不依赖选区
- **复制**:`disabled={!mdMenu().text.trim()}` 灰显 + Ctrl+C 提示
- **导出 Word**:始终可用

`disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent` CSS class 已有(此前 fallback 路径里就用的),0 新样式。

## 影响范围

- ✅ `.md` 文件查看器右键菜单
- ❌ 不影响 chat 侧 / `@pierre/diffs` shadow DOM 路径(`renderDefault`)
- ❌ 不影响 i18n / 后端 / sdk

## 验证

GUI 自动化端到端(macOS Mac arm64,build 完整 .app):
- 启动 DeskFox + 打开 `~/Downloads/README-MVP.md`
- 右键 viewer 文档区(WebKit 自动选词):4 项全显,全部可点 ✅
- 右键 viewer 空白处(无选区):4 项全显,"添加到聊天窗口" + "复制" 灰显 disabled,"编辑" + "Export as Word" 正常可用 ✅

## 行数

| 项 | 行数 |
|---|---|
| `file-tabs.tsx` insertions / deletions | +34 / -46 净 -12 |
| 文档 | ~50 行 |

Tiny 级,在规范 v2 阈值内。0 R4 / 0 黑名单 / 0 上游侵入。

## 回退方法

`git revert c25214889` — 回到"选了文字 4 项 / 没选 1 项"的两套行为。
