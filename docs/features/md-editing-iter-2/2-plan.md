---
feat-id: md-editing-iter-2
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-editing-iter-2 — 实施计划

## 实施顺序

1. **项 1 软换行** — code-mirror-view.tsx 加 `EditorView.lineWrapping`
2. **项 2 选区色** — code-mirror-view.tsx 加 `drawSelection()` + index.css 调底色
3. **项 3 状态栏** — 新写 cm-status-bar.tsx 组件 + code-mirror-view.tsx 加 onSelectionChange prop + file-tabs.tsx 编辑态挂载
4. typecheck + 单测 + build 自测
5. commit on feat 分支(单笔或拆笔视改动量)
6. 等 user 同意 → merge dev → push

## 技术决策记录

(实施期间踩坑/方案推翻在此追加)

