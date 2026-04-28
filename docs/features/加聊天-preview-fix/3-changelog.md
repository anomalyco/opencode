---
feat-id: 加聊天-preview-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 加聊天-preview-fix — changelog

**关联 commit**: `b269ceb69`
**所在分支**: `feat/editable-file-viewer`
**baseline tag**: 沿用线(无新 baseline)
**触发原因**: User 报 `.md` 文件右键「添加到聊天窗口」后模型回答"看不到选中的文字"。详见 `1-spec.md` 触发原因段(双层根因:preview 字段从未进模型可见文本 + `findLineRange` 对 markdown 几乎必然失败)。

## 实际改动

### `packages/app/src/utils/comment-note.ts`(+13 / -4)

- `formatCommentNote` 签名加可选 `preview?: string`(对象签名拆多行排版)
- 函数体引入局部 `head`,在 preview 非空时追加 `\n\nSelected text:\n"""\n<preview>\n"""` 段;空则原样返
- `parseCommentNote` regex:
  - 改前:`...of (.+?): ([\s\S]+)$`(贪婪,会把尾部 Selected 块吞进 comment)
  - 改后:`...of (.+?): ([\s\S]+?)(?:\n\nSelected text:\n"""\n[\s\S]*?\n""")?$`(comment 非贪婪 + 可选尾块,新旧消息都能匹配)
- match group 索引保持原状(path = match[5] / comment = match[6]),`message-timeline.tsx:56` 调用零变动

### `packages/app/src/components/prompt-input/build-request-parts.ts`(+1 / -1)

- L170 `formatCommentNote({ path, selection, comment })` → 加 `preview: item.preview` 字段。其余流程不变。

### 文档(本目录三件 + INDEX)

- `docs/features/加聊天-preview-fix/{1-spec,2-plan,3-changelog}.md`(新建)
- `docs/features/INDEX.md` 加索引行 + status 升 in-progress → done

## 行数

| 项 | 行数 |
|---|---|
| 修改上游 / fork-only 代码 | ~13 行(staged) |
| 文档(新文件,不计阈值) | ~270 行 |

代码 staged 远低于规范 v2 的 500 阈值,无 large-diff 标,无 override。

## 影响范围

- ✅ `.md` / `.py` / `.html` / `.ts` / `.json` 等所有走「右键添加到聊天窗口」的文件类型,模型现在能直接看到 DOM 选区文本
- ✅ 行评论 review 路径(`session.tsx:879 addCommentToContext`)同步受益(共用 `buildRequestParts`)
- ✅ 老消息 UI 渲染向后兼容(`message-timeline.tsx:56` `readCommentMetadata` 优先,`parseCommentNote` regex 容旧格式)
- ⚠️ 每条加聊天 synthetic text 增量 ≤ ~520 字符(三引号 + 标题 + `truncatePreview` 500 上限)。typical session 几条评论无感知,极端用户大量加评论时累积量需观察(R6 已含)
- ✅ server 端 `prompt.ts` 不感知本次改动,文件 URL `?start=&end=` 管线维持原样

## 回归测试点

均按用户在 release `DeskFox.exe`(`packages/desktop/src-tauri/target/release/DeskFox.exe`,2m10s 实编译)双击实测通过:

- **R1** `.md` 选区(含 `**bold**` 等格式符)右键加聊天 → 模型在回答中复述/识别选中文字 → ✅
- **R2** `.py` / `.html` / `.ts` / `.json` 等纯文本同样 → ✅
- **R3** 跨表格 / 跨列表项选区(`findLineRange` 失败用例)→ 仍能让模型看到选中文字 → ✅
- **R4** 行评论 review 路径 → ✅
- **R5** 老消息 UI 渲染正常,向后兼容 → ✅
- **R6** prompt 体积无可观察的爆炸 → ✅

## review 自检

- [x] 仅触动 fork 白名单(`packages/app/src/{utils,components/prompt-input}` + `docs/features/`)
- [x] 无 FORK marker 需求(目标函数 / 调用块本身就是 fork-only 的右键加聊天链路,非新动上游)
- [x] git diff --stat 在预算内(staged 13 行 vs 预算 16 行 ✓)
- [x] 无新增依赖
- [x] 无"顺手改"未记录
- [x] typecheck 全过(14/14,`@opencode-ai/app` cache miss 实编译通过)
- [x] release 构建过(2m10s,6 个无关 unused warning)
- [x] 用户双击 R1-R6 全过

## 已知遗留

- `truncatePreview(text, 500)` 上限不动 — 超长选区会截,等用户实际遇到再放宽,本次刻意不耦合。
- `findLineRange` 对 markdown 标记的解析增强 — 不做。preview 进文本后行号已变成"额外印证"而非"唯一线索",不再是用户痛点。

## 回退方法

```
git revert <code commit hash>
```

2 个代码文件无 schema 变更,server 完全不感知,可直接 revert。docs 可保留作为决策记录,无需 revert。
