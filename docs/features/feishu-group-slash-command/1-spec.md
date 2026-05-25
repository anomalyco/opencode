---
feat-id: feishu-group-slash-command
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-group-slash-command — 1-spec(需求 + 验收)

## 背景

当前(2026-05-24)飞书桥接 group creation 有 **3 个触发路径**,跟自然语言强相关的有 2 个:

1. **LLM marker `[CREATE_GROUP:name]`**:system prompt 教 LLM 在 reply 里发标记 → pipeline 解析后弹 confirm-card。**问题**:`claude-code` 等 spawn-based provider **跳过 `role=system` 消息**,marker 协议对它们完全不生效。
2. **自然语言硬拦截 `isGroupCreationIntent`**:正则 `/(?:开|建|创建|新建|拉|搞|做)[^群]{0,20}群/` 等粗匹配。**问题**:误拦"如何建群" / "建立群体精神" / "新群规" 等查询/陈述,user 觉得 bot 迟钝。
3. **短形式 `parseCreateGroupShortForm`**:"建群 X" 空格分隔提取群名(半结构化)。**问题**:跟 #2 同时存在,UX 混淆。

User 反馈(2026-05-24):自然语言方案误触率不可接受,要求改成 **slash command 显式触发**(参考已有 `/new`)。

## 用户视角(交付物)

### 主路径:user 显式触发

user 在私聊里发:
```
/group 项目讨论
```

bot 弹 confirm-card("是否创建群 `项目讨论` 并把你拉进去?"),user 点 ✅ → 真的建群 + 拉 user 进群。

### 老姿势 → 引导新姿势

user 还按老习惯发 "帮我建群" / "建个群叫 X" 等 — pipeline 命中精准白名单(详见验收 #3.1)→ **不调 LLM**,直接 reply 友好引导:

```
你想创建群?请使用斜杠命令:

  /group <群名>

例:
  /group 项目讨论
  /group 产品需求-2026Q2

(创建后我会拉你进群,后续讨论在那里继续)
```

### LLM 不再主动建群

LLM(任何 provider)收到 user "建群"类请求 → 老的 marker 路径删除,system prompt 改成"任何建群相关请求引导 user 用 `/group`"。**对支持 system prompt 的 provider 有效;对跳过的 provider 由白名单兜底引导**。

## 验收标准

### 功能

1. ✅ **`/group <群名>` 命令解析**(reply-actions 新加 `parseGroupCommand` 纯函数):
   - 输入 `text` → 输出 `{ matched: true, groupName: "项目讨论" }` 或 `{ matched: false }`
   - 命中条件:`text.trim().startsWith("/group ")` + 后接非空群名(去掉 leading "/group " 后 trim 非空)
   - 群名允许字符:中文 / 英文 / 数字 / `-` / `_` / 空格(允许"项目讨论 2026Q2" 这种)
   - 群名长度限制:≤ 30 字符(飞书 chat name 上限,超出 reply 拒绝)
   - **不命中**:`/group`(无参数) / `/groupabc`(粘连) / `/Group X`(大写不命中,跟 `/new` 一致小写敏感)

2. ✅ **pipeline.handle() 集成**(message-pipeline.ts):
   - 在 `/new` 同级层、`runOpencode` 调用之前加 `/group` 分支
   - **群聊禁用**:`chatType !== "p2p"` + 命中 `/group` → reply "⚠️ /group 仅支持私聊(群里建子群 UX 不清晰)" + 不调 LLM
   - **私聊命中**:解析成功 → 弹 confirm-card(复用 ConfirmCardController) → user 点 ✅ → 调 `client.im.v1.chat.create({ name })` + 拉 user 进群
   - **解析失败**(`/group` 没参数):reply "⚠️ 用法:`/group <群名>`,例:`/group 项目讨论`"

3. ✅ **自然语言关键字白名单**(reply-actions.ts `isGroupCreationIntent` regex 替换):
   - **中文 14 个短语**(Tier 1+2):
     - Tier 1:`建群` / `创建群` / `新建群` / `拉群`
     - Tier 2:`建个群` / `建一个群` / `创建个群` / `创建一个群` / `新建个群` / `新建一个群` / `拉个群` / `拉一个群` / `开个群` / `开一个群`
   - **英文 4 个短语**:`create a group` / `make a group` / `start a group` / `new group`(全部 lowercase 比较)
   - **查询后缀排除**(命中短语后再检查,含则不拦放走 LLM):
     - 中文通用:`怎么` / `如何` / `方法` / `步骤` / `流程` / `教程` / `为什么`
     - 英文 `new group` 专用:` rule` / ` of ` / ` policy` / ` chat` / ` channel` / ` members` / ` settings`
     - 英文通用:` how` / ` how to`
   - 命中无排除 → pipeline reply 上面"老姿势 → 引导新姿势"那段文案 + 不调 LLM

4. ✅ **删除 LLM marker 路径**:
   - `reply-actions.ts` 删 `parseCreateGroupMarkers` 函数 + `CREATE_GROUP_MARKER_RE` regex + 相关 export
   - `message-pipeline.ts` 删 `CREATE_GROUP_MARKER_PROMPT` system prompt 段;在 system prompt 加新段"建群引导":教 LLM 看到建群请求时 reply "请用 /group <群名>"
   - `message-pipeline.ts handle()` 删调用 `parseCreateGroupMarkers` 那段,删 reply 包含 marker 时弹 confirm-card 的代码

5. ✅ **删除短形式提取**:
   - `reply-actions.ts` 删 `parseCreateGroupShortForm`
   - pipeline 内调用点同步删

### 数据 / 不回归

6. ✅ `/new` 命令行为不变
7. ✅ 既有 confirm-card UI 不变(`ConfirmCardController` 复用,只是调用点从"reply 含 marker"换成"`/group` 命中后")
8. ✅ 真建群逻辑(`group-creator.ts client.im.v1.chat.create + chatMembers.create`)不动 — `/group` 命令最终落到同一个 backend call
9. ✅ ATTACH / 飞书桥接其他功能不受影响

### 安全

10. ✅ 群名输入做基本校验:
    - 长度 ≤ 30 字符(防超限)
    - 不含飞书 chat name 禁用字符(目前飞书 API 没文档化具体禁用集 → 不主动校验,后端抛错时透传给 user)
    - 不做 HTML escape(飞书不渲染 HTML)
11. ✅ 群聊禁用 `/group` — 防止 user 在群里建子群产生混乱
12. ✅ Slash command 不绕过 imbot agent 权限(`/group` 路径**根本不调 LLM**,不存在权限问题)

### 测试 / 治理

13. ✅ R5 Medium ≥ 3 unit + 1 e2e:
    - `parseGroupCommand` 纯函数 ≥ 5 case(成功 / 无参数 / 粘连 / 中文名 / 超长群名 / 多空格)
    - `isGroupCreationIntent` 白名单 ≥ 10 case(覆盖 Tier 1 + Tier 2 抽样 + 英文 4 + 查询后缀排除 3)
    - `processFishuMessage`(集成) ≥ 3 case(`/group X` 命中走 confirm-card / `帮我建群` 命中走引导 reply / `如何建群` 走 LLM)
14. ✅ `bun run typecheck` 16/16
15. ✅ 三文档全套 + INDEX + 改动日志 entry

## 非目标(Out of scope)

- ❌ opencode TUI / 主 GUI 加 `/group`(user 拍板只改飞书 plugin)
- ❌ 群聊里加 `/group`(明确禁用,UX 不清晰)
- ❌ 多语言 fallback(只支持中文 + 英文)
- ❌ /group 之外的 slash command(比如 /list-group / /delete-group)— 留 backlog
- ❌ 群名 fuzzy matching / 重名检测(直接交给飞书后端处理)
- ❌ tab 自动补全(飞书 IM 框不支持)

## 安全 / 边界

- **群聊禁用 /group**:防止 user 在 group 里建子群,UX 混乱
- **群名长度兜底**:30 字符上限,主动拒绝(飞书后端硬限制是 30,主动拒绝信息友好)
- **/group 不走 LLM**:0 LLM 漂移风险,任何 provider 都一样
- **白名单替换 regex**:误拦率显著下降(预估 < 1%,vs 当前宽容 regex 的明显误拦)
- **查询后缀排除**:防"建群怎么操作" 等查询语句被拦
- **已知漏拦**(strict substring 设计 trade):"建一个X群" / "创建一个X群"(X 是任意词)— 中间字插入断开 contiguous 匹配,user 应改用 `/group <群名>` 显式触发或换说法("建群叫 X" 命中 Tier 1 "建群")。这部分漏拦走 LLM,system prompt 引导段会让 LLM 回"用 /group";对跳过 system prompt 的 provider 是已接受的漏拦风险

## 决策轨迹

- **方案 A/B/C 三选**(2026-05-24):
  - A:保留宽容 regex,降级为引导(误拦保留)
  - B:完全删除自然语言检测(provider-agnostic 失效,撞 imbot wall 风险)
  - C(选):缩窄 regex 为白名单 + 排除后缀 + 降级为 /group 引导
  - 选 C 理由:hard-block provider-agnostic 兜底价值高(防 imbot wall),误拦真因是 regex 太宽不是 hard-block 本身错;白名单缩窄是精准修法
- **删 [CREATE_GROUP:name] LLM marker 路径**(user 拍板):杜绝"LLM 主动建群"路径,统一只接 user 显式 /group
- **删 parseCreateGroupShortForm**("建群 X" 空格分隔):UX 干净,只接 /group 一条路;老用户被白名单引导回退
- **命令名 `/group`**(vs `/create-group` / `/cg`):跟 `/new` 等长 / 好记 / 语义清晰
- **群聊禁用**:跟 `/new` 一致策略(私聊行为不影响他人)

## 关联

- 上游:
  - `feishu-bridge-light`(2026-05-23) — [CREATE_GROUP:name] marker 协议引入
  - `feishu-create-group-toggle-gui`(2026-05-24) — flag 控制 + GUI 开关
  - `feishu-create-group-hard-block`(2026-05-24) — 自然语言硬拦截 + provider-agnostic 治理
- 触动文件:
  - `packages/adapter-feishu-lark/src/feishu/reply-actions.ts`(核心,主要改 isGroupCreationIntent + 删 parseCreateGroupMarkers + 删 parseCreateGroupShortForm + 新加 parseGroupCommand)
  - `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts`(handle() 加 /group 分支 + system prompt 改写 + 删 marker 解析点)
  - `packages/adapter-feishu-lark/src/feishu/__tests__/reply-actions.test.ts`(测试改造)
  - `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts`(集成测改造)
- 不动:
  - `group-creator.ts`(真建群 backend logic 不动)
  - `confirm-card-controller.ts`(UI 复用)
  - ATTACH / mention / 其他飞书桥接子系统
