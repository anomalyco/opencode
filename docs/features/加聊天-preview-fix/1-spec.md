---
feat-id: 加聊天-preview-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 加聊天-preview-fix — spec

## 触发原因

User 反馈:`.md` 文件查看器选 3 行文字 → 右键「添加到聊天窗口」→ 输入"我本次选中的文字是什么?" → 加入聊天 → 模型回答"我没有看到您选中的文字。请告诉我您选中了哪段内容,或者复制粘贴您选中的文字"。

数据流追踪发现 bug 是两处叠加,任何一条都会让模型拿不到选区:

### 主因 — preview 字段从未进入模型可见文本

`OPENCODE-PLAN/实施状态.md:262`(2026-04-25 落地说明)写明设计意图是"选中文字进 prompt context.preview,用户问题进 context.comment"。但实现走到 `buildRequestParts` 这一步时:

- `packages/app/src/components/prompt-input/build-request-parts.ts:170` 调 `formatCommentNote({ path, selection, comment })`,**没传 preview**
- `packages/app/src/utils/comment-note.ts:56` `formatCommentNote` 签名也没接 preview,只产出 `"The user made the following comment regarding lines X through Y of <path>: <comment>"`
- preview 进了 `createCommentMetadata({ ..., preview })` → `metadata.opencodeComment.preview`,**这只给前端 UI 渲染评论卡片用**(`message-timeline.tsx:56` 走 `readCommentMetadata`),完全不进模型 part

### 加重 — findLineRange 对 markdown 几乎必然失败

`file-tabs.tsx:137 findLineRange` 用 `selObj.toString()` 在源码里搜:

- DOM 选区文本:`机制解耦: Bindings 和 Pairing 是两个独立层面...`
- 源码:`1. **机制解耦**: Bindings 和 Pairing 是两个独立层面...`

`indexOf` 失败 → `normalizeWithMap`(只压空白,不消格式符)失败 → 返 `null` → `selection: undefined` → file URL 没 `?start=&end=` → server 端 `prompt.ts:1068` 把整个文件喂进去。

**两条线索同时丢:模型既没拿到选区文本,也没拿到行号 selection 标记。** 模型自然回"看不到"。

## 验收标准

- [ ] R1 `.md` 选区(含 `**bold**` / `*italic*` / inline code 等格式符)右键加聊天 → 模型能在回答中复述/识别选中文字
- [ ] R2 `.py` / `.html` / `.ts` / `.json` 等纯文本同样生效
- [ ] R3 跨表格单元格、跨列表项选区(`findLineRange` 失败用例)仍能让模型看到选中文字
- [ ] R4 行评论 review 路径(`session.tsx:879 addCommentToContext`)同步受益(同走 `buildRequestParts`)
- [ ] R5 老消息(部分老 part 无 metadata,走 `parseCommentNote` regex 兜底)UI 渲染正常,向后兼容
- [ ] R6 prompt 体积观察:typical 场景每条评论增量 ~50-500 字符,符合 `truncatePreview` 上限

## 不做什么

- **不动 `truncatePreview(text, 500)` 上限**:超长选区会截,但 prompt 体积 vs 完整度是另一权衡,等用户实际报"我选了 2000 字它只看到一半"再加。
- **不增强 `findLineRange` 对 markdown 标记的解析**:preview 进入文本后这条不再是关键路径(行号成了"额外印证"而非"唯一线索"),先不碰,避免 scope 蔓延。
- **不动 server 端 `prompt.ts` 文件 URL 处理**:`?start=&end=` 管线维持原样,server 完全不感知本次 fix。
- **不改 metadata 结构**:`metadata.opencodeComment.preview` 保留,前端 UI 渲染评论卡片仍走它,本次只增量"模型可见文本"通道。

## 架构选型

走"**最小诊断改 — synthetic text 加段**"。

只在前端 `formatCommentNote` 生成的 synthetic text 末尾追加 `Selected text:\n"""\n<preview>\n"""` 段。理由三条:

1. **格式无关性**:`buildRequestParts` 读 `item.preview / comment / selection` 时不分 mime 类型,**右键加聊天**(md / py / html / 任何文本)和**行评论加聊天**(review/file 两类 origin)入口共用,改一处覆盖全部链路。
2. **三向印证**:即便 `findLineRange` 命中行号,模型同时拿到「行号 + 文件那几行源码 + DOM 选区文本」,语义互补不冲突;命中失败时 DOM 选区文本独立兜底,不再两头空。
3. **向后兼容廉价**:`parseCommentNote` regex 改成「非贪婪 + 可选尾块」,旧消息(无 Selected text 段)继续匹配;新消息按需提取。又因 `message-timeline.tsx:56` 已 `readCommentMetadata(part.metadata) ?? parseCommentNote(part.text)`,metadata 优先 → regex 只是兜底 → 误匹影响很小。

## 关联

- 上次落地此功能的 commit:`14f8a7992`(改动日志 #7,2026-04-25)
- 相关 follow-up:`caf92d555`(改动日志 #11,shadow DOM 选区不消失)
- 设计意图原文:`D:/project/OPENCODE-PLAN/实施状态.md:262`
