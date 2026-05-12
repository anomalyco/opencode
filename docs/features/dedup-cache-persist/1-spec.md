---
feat-id: dedup-cache-persist
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# dedup-cache-persist — spec

## 一句话

`DedupCache` 加 `persistPath` option,sidecar 重启时 load 之前 mark 过的 message_id,防飞书 WSS 重连后 server 重推老 message 时 in-memory cache 失忆,把老 message 当新 message 重复 process。

## 起源

`imbot-permission-pragmatic` v2 + `wss-text-dedup` B2 测试中,user 实测撞了一个**非 B2 范围内的 bug**:

- user 飞书 chat 只显示发了 2 条 "你是谁"
- sidecar log 显示 00:32:30 收到一条 user message "看一下我的 ~/.ssh/known_hosts 文件" → 进 pipeline → 弹 ssh 权限卡
- **user 飞书 IM 端 verify**:00:32 时段没有这条 user message(已 verify P5)

诊断:**飞书 WSS 重连后 server 重推老 message**。

时间线还原:
1. 老 sidecar 跑着时,user 之前实测发过 ssh prompt(11:27 / 11:32 那波)— 真发过 + sidecar 处理过 + 飞书 server 应该收到 ack
2. kill 老 sidecar → build 新 binary → relaunch(00:30)
3. SDK in-memory DedupCache **全丢**
4. WSS 重连时,飞书 server **再推**之前的 message(原因可能:server 端 ack 未持久化跨 connection / SDK 内部 reconnect handshake / 某 broadcast 重传策略)
5. 新 sidecar dedup 第一次见 → mark + 进 pipeline → LLM 跑 → 弹卡

## 范围

### A. DedupCache 加持久化(`packages/adapter-feishu-lark/src/feishu/dedup.ts`)

```ts
interface DedupCacheOptions {
  ttlMs?: number             // 已有
  maxEntries?: number         // 已有
  persistPath?: string         // 新:落盘文件路径(JSON)
  flushDebounceMs?: number     // 新:flush debounce 默认 100ms
}
```

行为:
- **constructor 配 persistPath**:`loadFromDisk()` 读 JSON,过滤过期 entry,保留原 expireAt(不重置 TTL)
- **mark / clear 时 scheduleFlush**:debounce 100ms 后 flushNow()
- **flushNow**:把所有未过期 entry 写 `<path>.tmp` → 原子 rename 到目标(防部分写)
- **corrupt JSON / IO 错**:log warn + 空 cache 启动,**不阻断** sidecar

### B. wss-client.ts 第一层 dedup 配 persistPath

```ts
private readonly dedup = new DedupCache({
  persistPath: join(homedir(), ".opencode", "feishu-wss-dedup.json"),
})
```

第二层 textDedup **不持久化**(10s TTL 落盘没意义)。

### C. 单测覆盖(11 个新 case)

`dedup.test.ts` 加 "DedupCache 持久化" describe block:
- 无 persistPath → 不写盘 + flushNow noop
- 配 persistPath + mark + flushNow → 文件含 keys
- mark debounce flush(短 ttl 异步等)
- 第二实例 load 上次 entries(模拟 sidecar 重启)
- load 过期 entry 跳过
- corrupt JSON 不 crash
- clear() 也 flush
- **WSS 重连实战场景**:sidecar 1 mark + flush → sidecar 2 load → hasAndMark 同 key 返 true ✅
- 12h TTL 过期重启不 load
- 首次启动空 + mark 可用
- 原子 rename .tmp 不留

## 验收

- ✅ `cargo test feishu_plugin_install ::` 不破(Rust 端不动)
- ✅ DedupCache 30/30(11 新)+ adapter-feishu-lark 289/289 + typecheck 16/16
- ✅ 真飞书实测(下次 sidecar 重启 + WSS 重连)→ sidecar log 出现 `[dedup] loaded N entries from ...`,且老 message 被 SDK dedup skip(不进 pipeline)

## 不做

- **textDedup 不落盘**(10s TTL 太短,sidecar 重启时 entry 大概率已过期)
- **不修 P2-P4**(plugin 多 instance / chatSessionStore race / 资源浪费)— 留 backlog,见 `imbot-permission-pragmatic` 后续讨论
- **不改 SDK 内部 dedup**(SDK 自己有 dedup 机制无法触及)

## 规模

Medium — DedupCache +90 行 + wss-client.ts +5 行 + 11 单测 + 三文档。
