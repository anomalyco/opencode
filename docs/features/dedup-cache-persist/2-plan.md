---
feat-id: dedup-cache-persist
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# dedup-cache-persist — plan

## 决策轨迹

### 1. 诊断:WSS 重连重推老 message + dedup 失忆

实测撞 + log 分析:
- sidecar 重启后 in-memory DedupCache 空白
- 飞书 WSS 重连后 server 又推 user 之前发过的 message_id
- 新 cache 第一次见 → 不 skip → 进 pipeline → 弹卡 + LLM 跑

**P5 verify** 确认:user 飞书 IM 端那个时段没显示这条 user message → 服务端重推。

### 2. 修法选择 — A(落盘)vs B(plugin singleton)

讨论过 4 方案:

| 方案 | 修 P1(dedup 失忆) | 修 P2-P4(plugin 多 instance) |
|---|---|---|
| A | ✅ | ❌ |
| B | ❌ | ✅ |
| C(A+B) | ✅ + ✅ | ✅ + ✅ |
| **D'(只 A)** | ✅ | 留 backlog |

**选 D'**:
- P1 是 user 真撞了的 bug,A 直接命中
- P2-P4 user 0 感知(功能 work,只是资源浪费 + 偶尔潜在 race)
- B 改动复杂度高 + 风险高(`globalThis` 在 opencode plugin loader 是否真共享未 spike 过)
- A 风险低(类似 chatSessionStore 落盘模式,有先例)

### 3. 实施关键点

- **原子 rename**:写 `.tmp` 再 rename,防中途 crash 留半写文件
- **debounce 100ms**:防 flush 抖动(高频 mark 不连续写盘)
- **过期 entry 不写出 / load 时过滤**:keep 文件小 + 防"过期 entry 被 load 后又被 lazy expire 浪费 IO"
- **corrupt JSON 不 crash**:log warn + 空 cache 启动,优雅降级
- **flush IO 异常不阻断**:cache 内存功能仍 work,只是当前 session 重启会失忆(等价没修)

### 4. flushDebounceMs 选 100ms

- 1ms / 同步写:WSS 高频 mark 时狂写,IO 浪费
- 100ms:WSS 一次 message process ~ms 级,100ms 内多 mark 合并一次 flush;sidecar 关闭时如果未 flush 损失最多 100ms 的 mark(可接受,SDK 内部 ack 应该让飞书 server 不会立刻重推)
- 1s+:sidecar 关闭后未 flush 损失大,重启可能误 process 这 1s 内 user 发的 message

### 5. textDedup 不落盘

ttl=10s,sidecar 重启耗时通常 >10s(build + relaunch),entry 几乎都过期了。落盘等于无效 IO。

### 6. 不解决 P2-P4

`imbot-permission-pragmatic` changelog 已记 P2/P3/P4 是 plugin 多 instance 的副作用:
- 3 个 WSSClient 各自独立 dedup
- 3 个 plugin server 浪费 port
- chatSessionStore 文件并发写 race

A 落盘只在**单 instance** 真 work(其他 2 个 instance 仍 in-memory)。但实测 3 个 instance 中**飞书后台只 push 给 1 个 connection**(P5 case 中实际只 1 个 pipeline process),所以 A 仍能拦下重推。

future:**修 P2(plugin singleton)后,3 个 instance → 1 个,A 100% 覆盖所有 message**。但 P2 是结构性改造,留 backlog。

## 顺序

1. DedupCache 加 persistPath option + loadFromDisk / scheduleFlush / flushNow
2. wss-client.ts 第一层 dedup 配 persistPath
3. 11 新单测覆盖
4. typecheck + test 全过
5. 三文档落盘
6. commit + 合 dev + push

## 不做

- 不引入新 cache 类(直接扩 DedupCache)
- 不持久化 textDedup(10s TTL 无意义)
- 不动 SDK 内部 dedup
- 不顺手修 P2-P4(scope creep,B 单独评估)

## 关联

- 起源:`wss-text-dedup` 测试时 user 实测 + P5 verify
- 不修但相关:`imbot-permission-pragmatic` P2-P4 backlog
- 下笔候选(留 backlog):**B — plugin process-level singleton**(消除 3 instance / chatSessionStore race / WSSClient ×3 资源浪费)
