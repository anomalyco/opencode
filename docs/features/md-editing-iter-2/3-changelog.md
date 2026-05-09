---
feat-id: md-editing-iter-2
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-editing-iter-2 — changelog

**所在分支**:`feat/md-editing-iter-2`(待 merge dev)
**baseline**:`20a6625ee`(本笔起点 = dev 当时 HEAD)

## Commit 列表

```
f3b7ac70f  docs(features): md-editing-iter-2 三文档 — 软换行 / 选区色 / 状态栏  [feat: md-editing-iter-2]
40905c6a1  feat(file-viewer/editor): iter-2 基础体验 — 软换行 + 选区色 + 状态栏  [feat: md-editing-iter-2]
```

## 改动文件

| 文件 | 行数 | 性质 |
|---|---|---|
| `packages/app/src/components/code-mirror-view.tsx` | +25 / -1 | 加 `EditorView.lineWrapping` + `drawSelection()` + `onCursorChange` prop + mount 初始回调 |
| `packages/app/src/components/cm-status-bar.tsx` | +29 (新) | 状态栏组件,显示行/列/选中字符数 |
| `packages/app/src/components/cm-status-bar.test.ts` | +75 (新) | 7 单测覆盖光标计算(空文档/单行/多行/中文/选区/跨行/反向)|
| `packages/app/src/index.css` | +7 / -1 | 选区底色换 GitHub 蓝半透明 |
| `packages/app/src/i18n/en.ts` | +4 | 加 statusBar.line / col / sel |
| `packages/app/src/i18n/zh.ts` | +4 | 同上(行/列/已选)|
| `packages/app/src/i18n/zht.ts` | +4 | 同上(行/欄/已選)|
| `packages/app/src/pages/session/file-tabs.tsx` | +12 / -1 | 加 cursorInfo signal + 接 onCursorChange + 挂 CmStatusBar |
| `docs/features/md-editing-iter-2/{1-spec,2-plan,3-changelog}.md` | +148 (新)| 三文档 |

## 影响范围

- **编辑态体验**:核心改动 — 长行软换行 + 选区底色明显 + 行/列/选中字符数状态栏
- **预览渲染**:0 影响(独立代码路径,marked 不读 CM 状态)
- **Word 导出**:0 影响(读磁盘 .md 文本,不读 CM)
- **依赖**:**0 新 npm 包**(`drawSelection` 来自既有 `@codemirror/view`)
- **bundle 体积**:基本不变(几十字节级增量)

## 测试

- 单测:cm-status-bar.test.ts 7/7 全过
- typecheck:全 monorepo 通过(15/15 packages)
- 现有 592 单测 0 回归(1 fail = pre-existing Kobalte SSR 旧坑,无关本笔)
- 手测验收(2026-05-09 user):
  - ✅ 长行软换行,无水平滚动
  - ✅ 选区蓝色底色明显,多行选区行尾空白连贯
  - ✅ 状态栏行/列/选中字符数实时更新
  - ✅ 退出编辑态进预览渲染不变
  - ✅ Word 导出功能不影响

## 回归测试

- ✅ Read 模式 marked 渲染未变(viewer 走独立链路,不读 CM)
- ✅ 切 tab 自动退编辑态,状态栏一并消失
- ✅ Save / Cancel UX 不变
- ✅ Ctrl+F 搜索面板仍可开(本笔不动)
- ✅ 撤销栈 Ctrl+Z 仍按字符级回退(不按视觉折行)

## 已知遗留 / deferred

- **AI 改写选区**(原 spec 项 4)— D4=B 拆出,后续 feat-id 暂定 `md-editing-ai-rewrite`,本笔不做。理由:涉及 chat session 调用栈,真出 bug 会牵连聊天功能;基础 3 项不沾 chat,完全隔离便于回归与回退
- **选区色待 user 长期使用反馈**:当前固定 `rgba(56, 139, 253, 0.35)` GitHub 蓝;若长期使用觉得不合适,5 分钟可换暖黄 `rgba(255, 213, 0, 0.35)` 或跟随 brand 的 `color-mix(in oklab, var(--primary) 35%, transparent)`。**index.css 已留候选注释方便后续改**

## 回退方法

如果生产出意外问题:
1. revert 两笔 commit:`git revert 40905c6a1 f3b7ac70f`
2. 或工作树:`git checkout dev -- packages/app/src/components/code-mirror-view.tsx packages/app/src/components/cm-status-bar.tsx packages/app/src/components/cm-status-bar.test.ts packages/app/src/index.css packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts packages/app/src/i18n/zht.ts packages/app/src/pages/session/file-tabs.tsx`(三文档 + 单测可保留)
3. 影响 = 编辑器回到 iter-1 状态:长行横滚 / 选区灰底 / 无状态栏。其他功能(列表续延 / Ctrl+B I K / 搜索 / 拖图等)全部保留

## 状态
done(2026-05-09 验收通过,待 merge dev + push)
