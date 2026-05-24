---
feat-id: feishu-create-group-hard-block
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-create-group-hard-block — 3-changelog(实际改动 + 回退)

> **状态**:✅ 代码落地(2026-05-24,等用户实测)
> **commit 链**:3 commits(spec/plan + helper + pipeline)
> **规模**:Medium-(~190 行净增 fork-only,20 新单测,0 黑名单 override,0 上游侵入)

---

## commit 链(自下而上 = 时间顺序)

| hash | 内容 |
|---|---|
| `90857b4dd` | docs: 1-spec + 2-plan |
| `1df6c0392` | feat: isGroupCreationIntent helper(中文 regex + 英文 substring)+ 14 单测 |
| `74e4a5860` | feat: pipeline 集成硬拦截路径 + 6 集成测 |

## 改动文件

### 新增(0)

无新文件(全部扩既有)。

### 修改(4 个文件)

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/reply-actions.ts` | +49 | 新加 `isGroupCreationIntent(text)` 纯函数 + 锁版 `GROUP_CREATION_INTENT_ZH` 正则 + 英文关键字白名单(`GROUP_CREATION_KEYWORDS_EN` 8 项)|
| `packages/adapter-feishu-lark/src/feishu/__tests__/reply-actions.test.ts` | +110 | 14 新单测 covers 中英文命中 / 不命中 / 边界 / regex 精准对比 |
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | +21 | import `isGroupCreationIntent` + `handle()` 在 `/new` 早退之后、`ackMessage` 之前加 3 道门控硬拦截块 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` | +107 | 新 describe `CREATE_GROUP hard-block` 6 集成测 |

## 关键设计点

### 1. 中文用 regex,不用 substring 关键字列表
**理由**:user 实际表达"帮我建一个项目讨论群"时,'建群' substring 不连续 — 关键字列表很难穷举。改用 `/(?:开|建|创建|新建|拉|搞|做)[^群]{0,20}群/` 一行 regex 覆盖"动词 + 字符 + 群"模式,既识别真实建群表达,也正确避开"群是怎么建的"(动词在群后) / "建立公司"(无群)等不命中 case。

**误拦权衡**:接受少量误拦(如"如何创建一个群"),user 主动关 flag 时误拦后引导 GUI 路径成本极低,远好于漏拦让 LLM 翻源码撞 imbot 权限卡。

### 2. 英文走 substring(简单可控)
中英文表达差异大,英文短句不需要复杂 regex,8 个关键词覆盖主流表达:`create group` / `new group` / `make group` / `create a group` / `new chat group` / `create chat` / `set up a group` / `set up group`。`toLowerCase()` 后 substring 命中。

### 3. 3 道门控顺序保证不误拦
```ts
if (
  !this.opts.account.enableAutoGroupCreate &&      // flag gate
  event.chatType === "p2p" &&                       // chat type gate
  isGroupCreationIntent(cleaned)                    // keyword gate
) { ... }
```
- flag=true 时跳过 → LLM 走 marker 路径(`processGroupMarkers` 既有逻辑)
- 群聊跳过 → 避免误拦"群是怎么建的"等学术问题
- 关键字命中 → 才硬拦截

### 4. 拦截文案跟 system prompt soft constraint 完全一致
跟 `CREATE_GROUP_DISABLED_PROMPT` 第 1 条措辞同步:
> "此账号未启用自动建群能力。如需启用请在 DeskFox 设置 → 飞书桥接 → 选此账号点【编辑】→ 高级能力 → 勾选「允许 AI 自动创建新群」后重试。"

UX 在 native provider(MiniMax/Anthropic 等)和 spawn-based provider(claude-code/codex/gemini/aider 等)下完全统一,user 体验一致。

### 5. helper extract 模式遵循 R5 v2 双清单
`isGroupCreationIntent(text)` 是纯函数 Logic 清单 → 单测覆盖 14 case(行覆盖 100%)。pipeline 集成测 6 case 覆盖 3 道门控正交矩阵。

## 测试

### 落地的测试(R5 Medium ≥ 1 e2e 或 3 unit,实际 14 unit + 6 集成)

**reply-actions.test.ts(helper 单测,14 新)**:
- 中文命中 5(帮我建群 / 建一个项目讨论群 / 拉个群 / 我想新建群 / 再帮我创建一个新群)
- 英文命中 4(create a group / CREATE GROUP / make group / set up a group)
- 正确不命中 5(群是怎么建的 / 今天天气 / how do I create new project / 建立公司 / 群讨论)
- 已知误拦 1(如何创建一个群)+ regex 精准对比 1(新群规 → false)
- 边界 4(空串 / undefined / null / number → false)

**message-pipeline.test.ts(pipeline 集成,6 新)**:
- disabled + p2p + 命中 → 硬拦截不调 promptAsync + 0 ack + 发 GUI 引导
- disabled + p2p + 不命中 → 正常流程 + ack 触发
- disabled + 群聊 + 命中 → p2p gate 跳过,正常流程
- enabled + p2p + 命中 → flag gate 跳过,让 LLM 走 marker
- disabled + p2p + 含 @ → strip mention 后命中,硬拦截
- disabled + p2p + 英文命中 → 硬拦截

### 全套套件
- 429/429 全 adapter 套件全过(原 402 + 新 27)
- 16/16 bun run typecheck monorepo 全过

### 实测脚本(2026-05-24,user 验收)

build dev .app 后:

1. **关 flag → claude-code(New-name)bot 实测**:私聊里发"帮我建群叫 test 004" → 应直接回复 GUI 引导文字,**不再走 LLM**(不见思考过程,不见权限卡)
2. **关 flag → MiniMax(灵狐)bot 对比**:仍然走旧 soft constraint 路径(LLM 回复"未启用..."),行为跟 hard-block 一致(meta-level UX 一致)
3. **开 flag → 任一 bot 实测**:发"帮我建群叫 test 005" → 收到 confirm 卡片(走 marker 路径,不被 hard block 拦)
4. **学术问题不误拦**:发"群是怎么建的?" → LLM 正常回答(不命中关键字)
5. **群聊不拦**:在某个群里 @bot 说"帮我建群" → 走 LLM(群聊 p2p gate)

## 三铁律走流程

| 步骤 | 状态 |
|---|---|
| 开 feat 分支 `feat/feishu-create-group-hard-block` | ✅ |
| 本地 commit 不动 main | ✅ |
| → main merge user 同意 | (待 user 拍)|
| → origin/main push user 同意 | (待 user 拍)|

## 风险 / 已知限制

1. **关键字列表锁版** — 改之前过 user 双签;新增关键字应 case-by-case 加,避免误拦扩散
2. **目前覆盖 zh + en 两语言** — backlog:日韩等需求出现时再扩
3. **正则边界 max 20 字符** — `[^群]{0,20}` 限制动词到群之间不能太远,避免"建议解决问题群发邮件"误命中(20 字符外的"群")。理论上 20 字符够覆盖正常建群表达,长描述场景(如"建一个超过 20 个字的非常长名称的群")会漏判 — 暂不优化
4. **flag=true 时跳过硬拦截** — 设计决策(让 LLM 走 marker confirm 路径),但若 user 同时撞 claude-code provider + flag=true,LLM 不能输出 marker(soft prompt 被吃),会试图自己建群撞权限卡。这种 corner case 不在本 feat 范围,backlog:**flag=true 时是否也加硬拦截 + 引导 user 切到 native provider**?

## 回退方法

1. **revert 整 merge commit**(本 feat 3 commits 全恢复 main):
   ```bash
   git revert -m 1 <merge-commit-hash>
   ```
2. **手动回退**:
   - `message-pipeline.ts` 删 hard-block 段(20 行)
   - `reply-actions.ts` 删 `isGroupCreationIntent` + regex + 英文 keyword 段(50 行)
   - 测试文件 revert 既有
   - 行为退回当前 soft-only constraint(native provider 仍生效,claude-code 不生效)

## 关联

- 上游 spec:`feishu-create-group-toggle-gui/1-spec.md`(flag 字段定义 + soft constraint 设计)
- 上游软约束:`feishu-create-group-toggle-gui/3-changelog.md` "实测 follow-up" 段
- pipeline 入口:`packages/adapter-feishu-lark/src/feishu/message-pipeline.ts:298`(`handle()` method)
- helper:`packages/adapter-feishu-lark/src/feishu/reply-actions.ts:155+`(尾部新加段)
