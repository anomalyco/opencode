---
feat-id: dedup-cache-persist
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# dedup-cache-persist — changelog

## 一句话

DedupCache 加 persistPath option(JSON 落盘 + 100ms debounce flush + 原子 rename),wss 第一层 dedup 配到 `~/.opencode/feishu-wss-dedup.json`,sidecar 重启后老 message_id 仍能识别 skip,防飞书 WSS 重连后 server 重推老 message 重复 process。

## commit 列表

| commit | 简述 |
|---|---|
| `e38d655b7` | feat:DedupCache 加 persistPath 持久化 |
| ``0abfd035c`` | docs:三文档 + INDEX + 改动日志 |

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/dedup.ts` | +75 / -1 | 加 persistPath / flushDebounceMs option;loadFromDisk / scheduleFlush / flushNow methods;mark / clear 触发 scheduleFlush |
| `packages/adapter-feishu-lark/src/feishu/wss-client.ts` | +5 / -1 | import homedir/join + dedup instance 配 persistPath = `~/.opencode/feishu-wss-dedup.json` |
| `packages/adapter-feishu-lark/src/feishu/__tests__/dedup.test.ts` | +138 / -1 | 加 "DedupCache 持久化" describe + 11 单测 |

## 核心 diff(dedup.ts)

```diff
+import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
+import { dirname } from "node:path"

 export interface DedupCacheOptions {
   ttlMs?: number
   maxEntries?: number
+  persistPath?: string        // 新
+  flushDebounceMs?: number    // 新
 }

 export class DedupCache {
+  private readonly persistPath: string | undefined
+  private readonly flushDebounceMs: number
+  private flushTimer: ReturnType<typeof setTimeout> | undefined

   constructor(options: DedupCacheOptions = {}) {
     ...
+    this.persistPath = options.persistPath
+    this.flushDebounceMs = options.flushDebounceMs ?? 100
+    if (this.persistPath) this.loadFromDisk()
   }

   mark(key) {
     ...
+    if (this.persistPath) this.scheduleFlush()
   }

   clear() {
     this.map.clear()
+    if (this.persistPath) this.scheduleFlush()
   }

+  flushNow(): void {
+    // .tmp → 原子 rename;只 write 未过期 entry
+  }
+  private scheduleFlush(): void { /* 100ms debounce */ }
+  private loadFromDisk(): void {
+    // 过滤过期 entry / corrupt JSON 不 crash / 空文件不报错
+  }
 }
```

## 核心 diff(wss-client.ts)

```diff
+import { homedir } from "node:os"
+import { join } from "node:path"

- private readonly dedup = new DedupCache()
+ private readonly dedup = new DedupCache({
+   persistPath: join(homedir(), ".opencode", "feishu-wss-dedup.json"),
+ })
```

textDedup **不动**(10s TTL 落盘没意义)。

## 测试

| Suite | Result |
|---|---|
| **dedup.test.ts(含 11 新 persist 测试)** | **30/30 ✅** |
| adapter-feishu-lark 全套 | **289/289 ✅**(278 → 289) |
| monorepo typecheck | **16/16 ✅** |

11 新单测覆盖场景:
1. 无 persistPath → 不写盘 + flushNow noop
2. 配 persistPath + mark + flushNow → 文件含 keys
3. mark debounce flush(短 ttl 异步等)
4. **第二实例 load 上次 entries**(模拟 sidecar 重启)
5. load 过期 entry 跳过
6. corrupt JSON 不 crash
7. clear() 也 flush
8. **WSS 重连实战场景** — sidecar 1 mark + flush → sidecar 2 load → 老 message 被识别 skip ✅
9. 12h TTL 过期重启不 load
10. 首次启动空 + mark 可用
11. 原子 rename .tmp 不留

## 行为验证(对照 user 实测痛点)

| 场景 | 改前 | 改后 |
|---|---|---|
| 飞书发 message → sidecar process → ack | mark + in-memory | mark + 100ms 后落盘 |
| sidecar 重启 → WSS 重连 | DedupCache 空 | load `~/.opencode/feishu-wss-dedup.json` 恢复 mark |
| 飞书 server 重推老 message | 当新 message 处理(!) | 识别为已 ack,skip ✅ |
| 飞书 server 推真新 message(user 发的)| 处理 | 处理(不影响)|
| 用户 12h 后再发同 message_id(理论上不该,飞书 message_id 不重)| 处理 | TTL 过期允许处理(防止 stale 永远拦)|

## 实战验证(下次 sidecar 重启时观察)

启动 log 应出现:
```
[dedup] loaded N entries from /Users/openclaw/.opencode/feishu-wss-dedup.json
```

若 N=0(首次启动 / 文件不存在 / corrupt)→ 不打 log。

## 影响范围

- 净改动:3 文件 +218 / -3 行(含 11 新单测)
- 新文件:`~/.opencode/feishu-wss-dedup.json`(runtime 创建,sidecar 启动时 mkdirSync 兜底)
- R4 override:0
- 上游侵入:0(纯 fork-only adapter)

## 不修的(scope-limited 留 backlog)

- **P2-P4 plugin 多 instance**:本笔 A 在单 instance 真 work,多 instance 时 3 份各自落盘但飞书后台只 push 1 个 connection,A 仍能拦。结构性修留下笔 feat
- **textDedup 不落盘**:10s TTL 重启时基本都过期
- **chatSessionStore 文件 race**:P3 副作用,message rate 低很难撞

## 关联

- 起源:`wss-text-dedup` 测试中 user 实测撞 ssh 神秘卡片 + P5 飞书 IM 验证 user 没发过 → 服务端重推 + dedup 失忆
- 跟相关 feat:`feishu-bridge-empty-reply-ghost`(Win 端历史的 dedup 测试链)/ `wss-text-dedup`(第二层 dedup)/ `imbot-permission-pragmatic`(让 LLM 安全运行,不致命但弹卡)
- FUTURE:**plugin process-level singleton**(globalThis 模式)消除 P2-P4 — 需先 spike 验证 opencode plugin loader 行为
