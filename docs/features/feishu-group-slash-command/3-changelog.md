---
feat-id: feishu-group-slash-command
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-group-slash-command — 3-changelog

> **状态**:✅ 代码 + 测试落地(2026-05-24,等用户实测)
> **commit 链**:3 commits(spec/plan + 主实施 + changelog)
> **规模**:Medium 净 -378 行(508 新增 - 886 删除,主要是删 ~900 行旧 LLM marker / regex / 测试块)+ ~250 行测试 / 0 上游侵入 / 0 R4

## commit 链

| hash | 内容 |
|---|---|
| `dcc15ee71` | docs: 1-spec + 2-plan + INDEX entry |
| `298628e62` | feat: /group 命令 + 白名单 + 删 [CREATE_GROUP] marker 路径 + 测试改造 |
| (本次填) | docs: 3-changelog + 改动日志 entry |

## 改动文件

| 文件 | 净行数 | 主要改动 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/reply-actions.ts` | +12 / -116 | 新加 `parseGroupCommand` + `GROUP_NAME_MAX_LEN` export + 改写 `isGroupCreationIntent`(宽容 regex → 14 中文 + 4 英文白名单 + 排除后缀);**删** `CREATE_GROUP_MARKER_RE` / `parseCreateGroupMarkers` / `parseCreateGroupShortForm` / `extractGroupName` / 双 ZH name pattern |
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | +66 / -157 | `handle()` 新加 `/group` 分支 + 自然语言关键字降级为引导(替换 hard-block GUI 引导);**删** `processGroupMarkers` 方法 / `CREATE_GROUP_MARKER_PROMPT` / `CREATE_GROUP_DISABLED_PROMPT` / 用 marker 触发 confirm card 段;新加 `GROUP_CREATION_GUIDE_PROMPT`;`getSystemPrompt` 简化(不再按 flag 分支) |
| `packages/adapter-feishu-lark/src/feishu/__tests__/reply-actions.test.ts` | +160 / -198 | **删** `parseCreateGroupMarkers` describe / 旧 `isGroupCreationIntent` describe(老 regex case)/ `extractGroupName` describe;**新加** `parseGroupCommand` describe(12 case)+ 新版 `isGroupCreationIntent` describe(45 case 覆盖 Tier 1/2/查询排除/已知漏拦/英文/new group noun phrase 排除)|
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` | +179 / -415 | **删** CREATE_GROUP hard-block describe / processGroupMarkers describe / makeGroupFakes helper / makeEventGroup helper / GroupFakeCreateCall 类型;**新加** `/group slash command` describe(11 case)+ 改写 `getSystemPrompt` 测试段(4 case)|
| `docs/features/feishu-group-slash-command/1-spec.md` | +1 | 加"已知漏拦"段(strict substring 设计 trade 透明记录)|

## 关键设计点

### 1. 主路径:slash command `/group <群名>` 0 LLM 调用

```
user 发 "/group 项目讨论"
    ↓
message-pipeline.handle()
    ├─ 在调 runOpencode(LLM 调用入口)之前
    ├─ parseGroupCommand(cleaned) 命中
    ↓
group chat? → reply "/group 仅支持私聊";return
empty name? → reply 用法提示;return
too_long?  → reply "群名超长 ≤ 30 字符";return
    ↓
弹 confirm card(复用 ConfirmCardController)
    ↓
user 点 ✅
    ↓
client.im.v1.chat.create({ name }) + 拉 user 进群
```

**provider-agnostic**:claude-code / imbot / default 全行为一致,因为 `/group` 在 `runOpencode()` 之前就拦截了。

### 2. 自然语言回退:白名单短语 + 查询后缀排除 + 引导文案

**白名单 18 个短语**(user 拍板 2026-05-24):

- 中文 Tier 1(4):建群 / 创建群 / 新建群 / 拉群
- 中文 Tier 2(10):建个群 / 建一个群 / 创建个群 / 创建一个群 / 新建个群 / 新建一个群 / 拉个群 / 拉一个群 / 开个群 / 开一个群
- 英文(4):create a group / make a group / start a group / new group

**查询后缀排除**(命中短语后再过):

- 中文通用(7):怎么 / 如何 / 方法 / 步骤 / 流程 / 教程 / 为什么
- 英文 `new group` 专用(7):` rule` / ` of ` / ` policy` / ` chat` / ` channel` / ` members` / ` settings`
- 英文通用(2):` how` / ` how to`

**命中后处理**:不调 LLM,reply 5 行引导文案教用户用 `/group <群名>`。

### 3. 删 [CREATE_GROUP:name] LLM marker 路径

旧路径让 LLM 自己 emit `[CREATE_GROUP:name]` marker → pipeline 解析 → 弹 confirm card。问题:
- claude-code 等 spawn-based provider 跳过 system prompt → 完全失效
- LLM 漂移风险(emit 错位 / emit 错群名)

iter 4 删除整条路径,只接 user 显式 `/group`。**对支持 system prompt 的 provider 是 1 步变 2 步降级**(LLM 不再自动建群,要回"用 /group");对跳过 system 的 provider **没有任何回归**(他们以前就拿不到这能力)。

### 4. 删 `parseCreateGroupShortForm` 半结构化路径

旧路径"建群 X" 空格分隔提群名,跟 `/group X` UX 重叠。统一只走 `/group <群名>`,代码 + 测试同步删。

### 5. system prompt 简化

- **删**:`CREATE_GROUP_MARKER_PROMPT`(教 LLM emit marker)
- **删**:`CREATE_GROUP_DISABLED_PROMPT`(flag=false 时的"禁令")
- **新加**:`GROUP_CREATION_GUIDE_PROMPT`(任何 flag 状态下教 LLM 引导用 /group + 禁止替代路径 + 防凭证泄露)

`enableAutoGroupCreate` flag 现在**不再影响 system prompt 内容** — flag 关时 user 仍可 `/group` 建群(显式触发是 user 主动授权)。这个微调跟 user 在 spec 阶段确认 OK。

### 6. 群聊禁用 `/group`(跟 `/new` 一致)

群里建子群 UX 不清晰 → reply "⚠️ /group 仅支持私聊"。

### 7. 已知漏拦透明记录

`"建一个X群"` / `"创建一个X群"`(X 是任意词)— 中间字插入断开 contiguous 匹配 → strict substring 不命中。设计 trade:
- 漏拦 → 走 LLM → system prompt 引导段 → 对支持 system 的 provider 仍 OK
- 对跳过 system 的 provider 漏拦风险已接受(罕见且 user 可改用 `/group` 显式)

## 测试

### 新增 56 case + 删除 30 case(净 +26)

**reply-actions.test.ts**:
- `parseGroupCommand`(12 case):/group X / /group / /group + trailing space / 群名带空格 / 超 30 / 恰好 30 / /groupabc / /Group X / 普通文本 / 空 / undefined / null / GROUP_NAME_MAX_LEN export / trim 外层空格
- `isGroupCreationIntent`(45 case): Tier 1×4 / Tier 2×7 / 中文查询排除×7 / 已知漏拦×2 / 不命中×8 / 英文白名单×4 / 大写命中×1 / 英文查询排除×2 / new group noun phrase 排除×7 / 空安全×1 / 纯净命中×1

**message-pipeline.test.ts**:
- `/group slash command`(11 case):p2p /group X confirm card / /group 用法提示 / 超长拒绝 / 群聊拒绝 / 自然语言"帮我建群"引导 / 查询排除走 LLM / 不命中走 LLM / 群聊不拦 / mention strip 后命中 / 英文命中 / new group 排除
- `getSystemPrompt`(4 case):含 ATTACH 协议 + 建群引导 / 不含已删 marker / 防替代路径 + 防凭证 / base 含禁止反问

### 套件状态

- typecheck:16/16
- adapter-feishu-lark 套件:505/505(原 518 / 删 30 + 新 17 = 505)

## 三铁律走流程

| 步骤 | 状态 |
|---|---|
| 开 feat 分支 `feat/feishu-group-slash-command` | ✅ |
| 本地 commit 不动 main | ✅ |
| → main merge user 同意 | (待 user 拍)|
| → origin/main push user 同意 | (待 user 拍)|

## 实测建议(等 user 测)

build dev .app 装 `/Applications/DeskFox Dev.app` 后:

1. **主路径**:私聊发 `/group 项目讨论` → 弹 confirm card → 点 ✅ → 真建群 + 拉 user 进群
2. **用法错误**:
   - `/group`(无参数)→ reply 用法提示
   - `/group ` + 31 字符 → reply 超长拒绝
   - 群聊发 `/group X` → reply "仅支持私聊"
3. **自然语言引导**:
   - "帮我建群" → reply 引导用 /group
   - "建一个项目讨论群"(漏拦)→ 走 LLM,LLM 应该按 system prompt 回"用 /group"
   - "建群怎么操作"(查询)→ 走 LLM,正常对话
4. **provider 一致性**:绑 claude-code 试同样 /group X → 行为一致(因为路径不调 LLM)

## 风险 / 已知限制

1. **strict substring 漏拦**:"建一个X群" 类间接表达漏拦,user 需改用 /group 或换说法;system prompt 引导段对支持 system 的 provider 兜底
2. **`enableAutoGroupCreate` flag 语义变化**:flag 关时 user 仍可 /group 建群(主动授权)。如果 user 想完全禁用建群,需要在 GUI 加新开关(本 feat 没做,留 backlog)
3. **群聊不支持 /group**:接受(跟 /new 一致,UX 取舍)

## 回退方法

`git revert <主 commit 298628e62>` — 但这会把 `[CREATE_GROUP:name]` marker / `extractGroupName` / `parseCreateGroupShortForm` 等老代码全数恢复,慎用。

## 关联

- 上游 feats:`feishu-bridge-light`(marker 协议引入)+ `feishu-create-group-toggle-gui`(flag GUI 开关)+ `feishu-create-group-hard-block`(自然语言硬拦截)
- 触动文件:`reply-actions.ts` / `message-pipeline.ts` + 2 个测试文件
- 不动:`group-creator.ts`(真建群 backend logic)+ `confirm-card-controller.ts`(UI)+ ATTACH / mention 子系统
- 留 backlog:
  - `enableAutoGroupCreate` flag 是否彻底删 / 改语义(本 feat 保留兼容)
  - `/list-group` / `/delete-group` 等扩展 slash command(罕见需求,等真需要再做)
  - opencode TUI / 主 GUI 加 `/group`(user 明确 out of scope)
