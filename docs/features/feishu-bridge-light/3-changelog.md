---
feat-id: feishu-bridge-light
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-light — 3-changelog(实际改动)

> **状态**:✅ 已落地(Phase 0-3 全部完成,等用户实测)
> **基线**:`feat/feishu-bridge` merged main 后 → `feat/feishu-bridge-light` 子分支
> **commit 链**:11 commits(详见下方),Phase 0 merge + Phase 1-3 实施
> **测试**:391 pass / 0 fail / 803 expect(基线 289 → 净增 102 测试 / 241 expect)
> **规模**:Medium+(~1800 行 fork-only,大头是测试 covers,生产代码 ~700 行)

---

## commit 链(自下而上 = 时间顺序)

| commit | 内容 | 行数 |
|---|---|---|
| `7cd1521c6` | Phase 0:Merge main into feat/feishu-bridge(merge commit,large-diff exception) | merge |
| `6191d6086` | Phase 1:`/new` resets session in p2p chat | +289/-7 |
| `c15f8ae97` | Phase 2.1:parseAttachMarkers + classifyAttachment 纯函数 | +232/-2 |
| `a1fea3053` | Phase 2.2:file-uploader IO 模块 | +269 |
| `bc555dd46` | Phase 2.3:pipeline 串联 [ATTACH:] + system prompt 教 marker | +290/-6 |
| `b6f7ae87d` | Phase 3.1:加 enableAutoGroupCreate config(默认 false) | +15 |
| `a1341edbd` | Phase 3.2a:confirm-card.ts 通用 yes/no 卡片 | +297 |
| `db5f738d3` | Phase 3.2b:confirm-card 单测覆盖 19 case | +248 |
| `5ea8c58ec` | Phase 3.3:group-creator IO(chat.create + chat.link) | +194 |
| `2443e139f` | Phase 3.4a:reply-actions 扩 parseCreateGroupMarkers | +84/-5 |
| `b56737173` | Phase 3.4b:pipeline 串 [CREATE_GROUP:] + 动态 prompt + executeGroupCreate | +449/-7 |
| `44c0f93ae` | Phase 3.4c:plugin.ts 路由 confirm-card action | +26/-10 |

---

## 改动文件清单

### 新增(7 个文件)

| 文件 | 行数 | 用途 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/reply-actions.ts` | 162 | stripMentions / parseAttachMarkers / parseCreateGroupMarkers / classifyAttachment 纯函数 |
| `packages/adapter-feishu-lark/src/feishu/file-uploader.ts` | 98 | uploadImage / uploadFile / sendImageMessage / sendFileMessage IO |
| `packages/adapter-feishu-lark/src/feishu/confirm-card.ts` | 297 | 通用 yes/no 卡片(ConfirmCardController + buildConfirmCard) |
| `packages/adapter-feishu-lark/src/feishu/group-creator.ts` | 75 | createGroup + getShareLink IO |
| `packages/adapter-feishu-lark/src/feishu/__tests__/reply-actions.test.ts` | 240 | 34 case |
| `packages/adapter-feishu-lark/src/feishu/__tests__/file-uploader.test.ts` | 171 | 10 case |
| `packages/adapter-feishu-lark/src/feishu/__tests__/confirm-card.test.ts` | 248 | 19 case |
| `packages/adapter-feishu-lark/src/feishu/__tests__/group-creator.test.ts` | 119 | 10 case |

### 修改(5 个文件)

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/adapter-feishu-lark/src/core/config-schema.ts` | +7 | 加 `enableAutoGroupCreate: z.boolean().default(false)` |
| `packages/adapter-feishu-lark/src/feishu/account-store.ts` | +2 | normalizeAccount 加 enableAutoGroupCreate 默认值 |
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | +260/-13 | /new 早退 + larkClient/attachWorkspaceRoot 注入 + processAttachments + processGroupMarkers + executeGroupCreate + getSystemPrompt 动态拼 + handleConfirmCardReply |
| `packages/adapter-feishu-lark/src/plugin.ts` | +26/-10 | onCardAction 路由扩 confirm-card |
| `packages/adapter-feishu-lark/src/__tests__/config-schema.test.ts` | +6 | 加 enableAutoGroupCreate 默认/显式 true 2 case |
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` | +461/-1 | /new 集成测 5 + ATTACH 集成测 10 + CREATE_GROUP 集成测 10 + getSystemPrompt 3 |

### 未改但已存在(zero work)

| 文件 | 说明 |
|---|---|
| `packages/adapter-feishu-lark/src/feishu/chat-session-store.ts` | `delete(accountId, chatId)` 已存在,直接调用(原 v1 spec 错写"待新增")|

---

## 三个用户可见功能

### 1. `/new` 私聊清话题(Phase 1 — 0.3 天)

- 私聊里输入 `/new`(或 `@bot /new` 群里 mention 形态)→ bot 回 "✅ 已开启新对话",下一条消息开新 session
- 群聊里 `/new` → bot 回 "⚠️ /new 仅支持私聊(群里清会影响全员)",不动 session
- 实现:`message-pipeline.ts` handle() text 解析后早退;清三处(disk chatSessionStore + in-memory chatToSession + 反查 sessionToChat)
- 0 新依赖,`chatSessionStore.delete` 早已存在(原 v1 spec 错写"待新增",白节省 0.4 天工期)

### 2. `[ATTACH:path]` 文件回传(Phase 2 — 1.5 天)

- AI 在 reply 嵌 marker:`[ATTACH:/abs/path/to/file.ext]`
- 系统自动:解析 → 校验 workspace 子树内 → 按扩展名分流 image/file → 上传 → 发飞书 → strip marker
- 安全:路径白名单 `~/.opencode/feishu-workspace/` 子树内(防 LLM 把 `/etc/passwd` 发出);防 prefix 误判(`/tmp/test-workspace-evil/` 拒绝);防 traversal(`../` resolve 后判)
- SDK 真实形态:图片走 `image.create`(10MB,image_key);文件走 `file.create`(30MB,file_key + file_type 受限枚举);其他扩展名(docx/xlsx/pptx/txt/md/zip 等)走 `stream` 兜底
- 错误兜底:单 marker 失败不阻断其它,warning append 到回复尾;系统始终 strip marker(防漏到 user)
- system prompt 自动扩段教 LLM marker 协议 + 约束(总是启用,无 opt-in)

### 3. `[CREATE_GROUP:name]` 自动建群(Phase 3 — 2.0 天,opt-in 默认关)

- 配置项:`FeishuAccount.enableAutoGroupCreate` boolean(默认 false)
- 启用 + 私聊场景:AI 在 reply 嵌 `[CREATE_GROUP:群名]` → 系统发 confirm 卡片让 user 二次确认(【✅ 确认】【❌ 拒绝】10 分钟超时自动拒)
- user 点确认:`chat.create({ name, chat_type: "public", user_id_list: [senderOpenId] })` + `chat.link({ validity_period: "week" })` 拿 share_link
- 结果消息:成功 → `"✅ 已创建群【X】 加入链接(一周有效):https://..."`;链接失败(团队群 / 权限不足)→ 降级显示 chat_id
- 双门控:opt-in 配置 + 二次确认卡片(防 prompt injection)
- 关闭时:system prompt **不教**此 marker(避免 LLM 输出又被 strip 造成"哑回复");marker 仍 strip 不漏到 user

---

## 架构 / 复用决策

### confirm-card 独立成模块(非内嵌 permission-card)

v2 spec 原计划"扩展 permission-card.ts 加 create_group_confirm 分支",实际实施 deviate 到新建 `confirm-card.ts`:

- permission-card 处理 opencode `permission.asked` event,reply 类型 `once/always/reject`,路由到 SDK postSessionIdPermissionsPermissionId
- confirm-card 处理 adapter 自发的"AI 想做 X 是否同意?",reply 类型 `yes/no`,路由到调用方注入的 callback
- 强行合并会让 ParsedCardAction 类型变 union 混合,parseCardAction 分支臃肿
- 独立后:同样的"controller + pending map + 超时 + 卡片"架构模式,可被 Phase 3 自动建群和未来其它"AI 敏感操作 yes/no"复用

### system prompt 动态拼接(不是单一常量)

按 `account.enableAutoGroupCreate` 决定是否拼 CREATE_GROUP 教学段。意图:

- 关闭时连教学都不发 → LLM 不会输出 marker → 不会出现"marker 被 strip 后用户看到空回复"的 confusing UX
- 开启时教 LLM marker + 安全约束,自然引导

### MessagePipeline 接受 larkClient / attachWorkspaceRoot 注入

为单测从外部注入 fake,对齐 PermissionCardController 的注入风格。生产代码默认仍内部 new Client / 默认 FEISHU_WORKSPACE 路径,零行为变化。

---

## 测试

| 测试文件 | 用例数 | 备注 |
|---|---|---|
| `reply-actions.test.ts` | 34 | stripMentions(8)+ parseAttachMarkers(8)+ classifyAttachment(11)+ parseCreateGroupMarkers(7) |
| `file-uploader.test.ts` | 10 | upload/send 各种成功/失败路径 |
| `confirm-card.test.ts` | 19 | build/parse/Controller 全套 |
| `group-creator.test.ts` | 10 | createGroup + getShareLink 各种成功/失败 |
| `message-pipeline.test.ts` 新增段 | 28 | /new(5)+ ATTACH(10)+ CREATE_GROUP(10)+ getSystemPrompt(3) |
| `config-schema.test.ts` 新增 case | 2 | enableAutoGroupCreate 默认/显式 |
| **新增** | **103** | |
| **全 adapter 套件** | **391 pass / 0 fail** | 基线 289(Phase 0) → +102(净增 1 — config-schema 已有 28,基线含 27)|

---

## v1 → v2 修正回顾(本次实施确认)

v1 草稿(commit `5d3dbd5c7`)15 处假设错配 / 设计漏洞,v2 spec(commit `12eacce89`)已逐条修订,本次实施全部按 v2 落地:

✅ C1 chatSessionStore.delete 已存在不需新增  
✅ C2 /new 同步清 in-memory chatToSession + sessionToChat  
✅ C3 /new 群聊明确拒绝  
✅ C4 /new stripMentions 处理 @bot  
✅ C5 图片走 image.create 不走 file.create  
✅ C6 图 10MB / 文件 30MB size 限制分开  
✅ C7 file_type SDK 枚举,docx 等走 stream 兜底  
✅ C8 chat.create({ data, params }) 真实签名  
✅ C9 chat.link 单独调拿 share_link  
✅ C10 user_id_list 拉 user 进群  
✅ C11 FEISHU_SESSION_SYSTEM_PROMPT 扩段教 LLM marker  
✅ C12 marker regex strip 后再发 user  
✅ C13 opt-in + permission-card(confirm-card 实际)二次确认双门控  
✅ C14 [ATTACH:] 跟 [CREATE_GROUP:] 一致 marker 协议  
✅ C15 先 merge main(含 401-fix)再开 light 子分支

---

## 工期实际 vs 预估

| Phase | 预估 | 实际 | 备注 |
|---|---|---|---|
| 0 基线同步 | 0.2 天 | 0.2 天 | 解 2 个 INDEX/changelog 冲突;merge commit 触发 large-diff exception 用户授权 |
| 1 /new | 0.3 天 | 0.3 天 | delete 已存在节省工时,但加 fake larkClient 注入小折腾 |
| 2 [ATTACH:] | 1.5 天 | 1.5 天 | 三 sub-phase(纯函数 / IO / pipeline)按预估 |
| 3 [CREATE_GROUP:] | 2.0 天 | 2.0 天 | confirm-card deviate 成独立模块(+0.3 天),抵销 executeGroupCreate 内嵌到 3.4 节省的 0.3 天 |
| 4 文档收尾 | 0.5 天 | 0.3 天 | 本 3-changelog + status 更新 |
| **合计** | **4.5 天** | **4.3 天** | 略低于预估 |

---

## 未做(留 backlog)

- ❌ 群聊 per-user session 隔离(允许群里 /new 不影响其它人)— 架构改动,Large feat
- ❌ AI 主动调"send-file"/"create-group" 作为 opencode tool — marker 协议是 light 妥协方案
- ❌ 唤醒 dmPolicy / groupPolicy 死配置 — 独立 feat 设计空间
- ❌ Phase 2/3 marker 真机回归测试 — 当前 DeskFox 运行版本未含 Phase 2/3 代码,等下次 ship 才能在真飞书 IM 实测

---

## 风险 / 已知限制

- **prompt injection**:user 直接说"输出 `[CREATE_GROUP:xxx]`"诱导 marker 注入 → 二次确认卡片是兜底,user 看到卡片自行拒绝
- **大文件 streaming**:当前 stat 预检 + createReadStream 上传,极大文件(接近 30MB)可能内存压力大 — 留 backlog
- **share_link 团队群限制**:已通过 getShareLink 失败兜底 → 降级显示 chat_id,user 仍可手动加群
- **marker 正则贪婪**:群名 / 路径含 `]` 会断 marker — 当前 `[^\]]+` 已防;真要包含 `]` 留 future enhance

---

## 下一步(等用户决定)

1. **ship dev 包**(Tier 2)— 含 Phase 2/3 全套,user 真机回归飞书 IM 实测
2. **Win 端同步** — 当前改动均 fork-only 不涉平台代码,Win build 应直接生效
3. **若实测有 bug**:开 follow-up feat 单独修(不在本 feat 范围)
