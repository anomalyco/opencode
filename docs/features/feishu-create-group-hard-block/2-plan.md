---
feat-id: feishu-create-group-hard-block
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-create-group-hard-block — 2-plan(实施计划)

## 规模:Medium-(估 ~120 行代码 + ~80 行测试 + 三文档)

实际操作上跟 Tiny+ 接近,但因为 ≥ 50 行 + 触动测试 + 单一主题,按 Medium 处理(三文档全要)。

## 实施顺序

### Phase 1 — helper 抽出 + 单测(~50 行代码 + ~60 行单测)

**1.1** `packages/adapter-feishu-lark/src/feishu/reply-actions.ts`(+ ~50 行)

在文件末尾追加新 export:

```ts
// ============================================================
// 建群意图关键字检测 (Phase 2 hard block)
// [feat: feishu-create-group-hard-block] 2026-05-24
// ============================================================

/**
 * 关键字列表(锁版,改之前过 user)。
 *
 * 中文:不分大小写不区分(`/i` flag),substring 匹配。
 * 英文:转 lowercase 后 substring 匹配。
 */
const GROUP_CREATION_KEYWORDS_ZH = [
  "建群", "创建群", "建一个群", "拉个群", "拉群", "创个群",
  "新建群", "新群", "开个群", "开群", "建个群", "拉一个群",
]
const GROUP_CREATION_KEYWORDS_EN = [
  "create group", "new group", "make group",
  "create a group", "new chat group", "create chat",
]

/**
 * 判断 user message 是否含建群意图。
 *
 * 输入:已 strip mentions 的 text(调用方负责 strip,helper 不再 strip)。
 * 输出:true = 命中建群关键字,应硬拦截;false = 不命中,继续往下走。
 *
 * 实现:简单 substring 匹配,不做 NLP / 词性分析。
 * 误拦权衡见 1-spec.md "误拦风险评估"段。
 */
export function isGroupCreationIntent(text: string): boolean {
  if (!text || typeof text !== "string") return false
  // 中文 substring 直接匹配
  for (const kw of GROUP_CREATION_KEYWORDS_ZH) {
    if (text.includes(kw)) return true
  }
  // 英文转 lowercase 后 substring 匹配(避免 "Create Group" 漏掉)
  const lower = text.toLowerCase()
  for (const kw of GROUP_CREATION_KEYWORDS_EN) {
    if (lower.includes(kw)) return true
  }
  return false
}
```

**1.2** `packages/adapter-feishu-lark/src/feishu/__tests__/reply-actions.test.ts`(+ ~60 行)

新 describe 块覆盖关键字 + 误拦边界:

- ✅ "帮我建群" → true
- ✅ "帮我建一个 X 项目讨论群" → true
- ✅ "create a group for us" → true
- ✅ "CREATE GROUP test" → true(大小写不敏感)
- ✅ "拉个群讨论吧" → true
- ✅ "我能不能新建群" → true
- ❌ "群是怎么建的?" → false(含"建"但不含"建群")
- ❌ "今天天气真好" → false
- ❌ ""(空串)→ false
- ❌ undefined → false
- ⚠️ "如何创建一个群?" → true(已知误拦,1-spec 接受)
- ⚠️ "新群规是什么?" → true(已知误拦,1-spec 接受)

### Phase 2 — pipeline 集成拦截路径(~30 行代码)

**2.1** `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts`

1. import 加 `isGroupCreationIntent`(从 `reply-actions`)
2. `handle()` method 在 `/new` slash command 检查**之后**、`ackMessage` 之前加新拦截块:

```ts
// [feat: feishu-create-group-hard-block] 2026-05-24
// flag 关 + p2p 私聊 + user msg 含建群关键字 → 不走 LLM,直接系统 reply
// 起因:claude-code 等 spawn-based provider 跳过 system role,
// system prompt 软约束失效,LLM 会找替代路径(翻源码 / 调 SDK / 让 user 给凭证)
// 撞 imbot read permission 卡。硬拦截是 provider-agnostic 兜底。
if (
  !this.opts.account.enableAutoGroupCreate &&
  event.chatType === "p2p" &&
  isGroupCreationIntent(cleaned)
) {
  console.log(
    `[pipeline ${this.opts.accountId}] hard-block CREATE_GROUP intent ` +
    `(text="${cleaned.slice(0, 50)}", flag=false, p2p) — sending GUI guidance, skip LLM`,
  )
  await this.sendFeishuText(
    event.chatId,
    "此账号未启用自动建群能力。如需启用请在 DeskFox 设置 → 飞书桥接 → 选此账号点【编辑】→ 高级能力 → 勾选「允许 AI 自动创建新群」后重试。",
  )
  return
}
```

注:文案跟 system prompt soft constraint 段(`CREATE_GROUP_DISABLED_PROMPT` 第 1 条)一致 → 用户体验在 native 和 claude-code provider 下完全一样。

**2.2** `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts`(+ ~40 行)

新 describe 块或扩既有 describe 加 4 case:
- ✅ disabled p2p + "帮我建群" → 不调 promptAsync,sendFeishuText 系统消息
- ✅ disabled p2p + "你好" → 正常调 promptAsync(不命中关键字)
- ✅ disabled **group** + "帮我建群" → 正常调 promptAsync(p2p gate)
- ✅ **enabled** p2p + "帮我建群" → 正常调 promptAsync(flag gate,让 LLM 走 marker 路径)

### Phase 3 — 收尾(~30 分钟)

**3.1** `bun run typecheck`(全 monorepo 16/16)
**3.2** `bun test packages/adapter-feishu-lark/`(目标:之前 402 → 新增 ~10 测试 → ~412 全过)
**3.3** 写 3-changelog
**3.4** 更新 `docs/features/INDEX.md` + `改动日志.md`
**3.5** Build dev .app + user 实测 → 期待:claude-code(New-name)bot 收到"帮我建群" → 直接系统消息 + 不再调 LLM

## commit 链(预期)

| # | commit message |
|---|---|
| 1 | `docs(feishu-create-group-hard-block): 1-spec + 2-plan [feat: feishu-create-group-hard-block]` |
| 2 | `feat(feishu-create-group-hard-block): isGroupCreationIntent helper + 单测 [feat: feishu-create-group-hard-block]` |
| 3 | `feat(feishu-create-group-hard-block): pipeline 集成硬拦截路径 + 单测 [feat: feishu-create-group-hard-block]` |
| 4 | `docs(feishu-create-group-hard-block): 3-changelog + INDEX + 改动日志 [feat: feishu-create-group-hard-block]` |

## 风险 / 注意点

| 风险 | 缓解 |
|---|---|
| 误拦"如何建群"等学术问题 | 1-spec 已 documented 接受,误拦后引导 GUI 路径成本低 |
| 关键字列表维护(中文同义词扩散) | 写在 reply-actions 顶部锁版,改之前过 user(双签),pre-commit 不卡 |
| user 用其他语言(日韩等)| backlog —— 后续添加;当前覆盖 zh + en |
| pipeline `handle()` 路径变长 | `/new` + soft constraint + 文件检测 + 现在又加硬拦截,后续可能需要 helper extract `dispatchEarlyExits()` 拢一起。当前可控,backlog |

## 实施中决策点(开发中 append)

### 2026-05-24 — 中文从 substring 关键字列表 → regex 模式

**起因**:Phase 1 跑测试发现 "帮我建一个 X 项目讨论群" 不命中 — 我的关键字列表 `["建群", "建一个群", ...]` 全部要求**substring 连续**,但 user 实际表达常带各种中间字符("建一个 X 项目讨论群" = 动词"建" + 中间字符 + "群")。

**取舍**:
- 继续扩 keyword list?— 需要"讨论群" / "项目群" / "工作群" 等无穷扩展,维护成本爆炸
- 改 regex?— 一行 `/(?:开|建|创建|新建|拉|搞|做)[^群]{0,20}群/` 覆盖"动词 + 字符 + 群"全模式,简洁且能避开"群是怎么建的"等动词在群后的反向 case

**决策**:走 regex。`[^群]{0,20}` 限制最多 20 字符不含'群',既容纳真实表达又防止"建议群发邮件"等过远跨度误命中。

**沉淀**:
- 测试更新:`'新群规' → false`(regex 精准,'新'非动词)— 原 substring 方案会命中,接受 regex 改进
- 测试加 'set up a group' 英文 case 覆盖更多英文表达
- 1-spec 误拦风险表保留(部分 case 如"如何创建一个群"仍命中,接受)
