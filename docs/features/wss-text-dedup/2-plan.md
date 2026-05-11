---
feat-id: wss-text-dedup
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# wss-text-dedup — plan

## 决策轨迹

### 1. 起源:imbot v2 实测中"为什么弹两次"

`imbot-permission-pragmatic` 实测后,user 反馈"我没发两次"。我查 log:
- 两条 user message id 不同
- SDK 内置 dedup 用 messageId+ts 拦 — message_id 不同,拦不住
- 飞书后台分配新 message_id = 真有 2 条独立 message

### 2. 推断原因(无确凿证据,但合理猜测)

| 可能 | 概率 |
|---|---|
| 飞书 IM 客户端连击发送(user 不察觉) | 中 |
| 飞书 IM 网络 retry,飞书后台当 2 条独立 message | 中 |
| user 用"消息撤回 + 重发" | 低 |
| user 用"复制粘贴 + Enter" | 低 |

无论哪种,**plugin 端可以加一层防御**:同 chat + 同 text + 短时间(10s)= 几乎 100% 是误触发。

### 3. 时间窗口 10s 怎么选

| 时间 | 风险 |
|---|---|
| 1-2s | 太短,网络 retry 都可能跨过 |
| **10s** | 用户真要重发同 prompt,大多会等 LLM 跑完(几十秒)再发;10s 内同样的 prompt 几乎 100% 是误触发 |
| 30-60s | 过长,user 真想 follow-up "请再来一次" 的合法场景会被拦 |

选 10s 平衡防御 + 灵活性。

### 4. 复用 DedupCache 不引入新类

DedupCache 已有完整设计(TTL + LRU + lazy expire + atomic hasAndMark + 19 个单测),新加 instance 配 `ttlMs=10_000` 即可,**不重复造轮子**。

### 5. 不加新单测(争议点)

`textDedup` 行为 = `DedupCache(10s)` 行为,已被 DedupCache 19/19 覆盖。wss-client.ts 嵌的逻辑(parse content + key 组合 + skip log)是简单 if-条件,**没单测基础设施**(wss-client 走 SDK EventDispatcher 无单测先例)。

接受这一 R5 测试纪律例外(Tiny 改动 + 现有 cache 已测覆盖)。

如果以后撞 bug,可以抽 helper `shouldSkipTextDedup(event, textDedup)` 出来加单测。

## 不做(scope-limited)

- **不防 image / file 类型 dedup** — 飞书后台对非 text 不大可能多推
- **不做 plugin → server / client 端 dedup** — 只 wss 入口处一道防线就够
- **不调 IM 客户端排查** — 客户端 bug 不是 fork 能修的

## 关联

- 起源:`imbot-permission-pragmatic` 实测中 user 反馈"为什么弹两次"
- 修补的是上层 plugin,**不修 opencode core / 上游 SDK**(R3 零黑名单 / R4 零 override)
- 下笔(留 backlog):**D — 卡片显示"本任务第 N 个权限请求"** UX 提示,让 user 心智模型对齐 LLM 多步顺序工作
