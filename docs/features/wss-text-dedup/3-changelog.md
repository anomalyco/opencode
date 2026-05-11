---
feat-id: wss-text-dedup
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# wss-text-dedup — changelog

## 一句话

wss-client.ts 加第二层 text dedup(同 chat 同文本 10s skip),防飞书 IM 连击 / retry 推不同 message_id 但内容一致的多条消息触发 LLM 重复执行。

## commit 列表

| commit | 简述 |
|---|---|
| `5d64b0a09` | feat(feishu-bridge): wss 加同 text 短期 dedup |
| `adb2d56c3` | docs(wss-text-dedup): 三文档 + INDEX + 改动日志 |

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/wss-client.ts` | +27 -1 | 加 `textDedup: DedupCache({ ttlMs: 10_000, maxEntries: 200 })` instance + 在 SDK dedup 之后的二级 check |

## 核心 diff

```diff
 export class FeishuWSSClient {
+  /** 第一层:同 messageId+ts 12h dedup(防 WSS 重连重放) */
   private readonly dedup = new DedupCache()
+  /** 第二层:同 chatId+text 10s 短期 dedup(防飞书 IM 客户端连击/retry) */
+  private readonly textDedup = new DedupCache({ ttlMs: 10_000, maxEntries: 200 })

   ...

   // dedup 第一层:同 messageId + ts(12h)— 防 WSS 重连重放
   if (this.dedup.hasAndMark(dedupKey)) {
     console.log(`[wss ${opts.accountId}] dedup skip ${event.messageId}`)
     return
   }
+
+  // dedup 第二层:同 chatId + text(10s)
+  if (event.messageType === "text") {
+    let txt = ""
+    try {
+      const parsed = JSON.parse(event.content) as { text?: string }
+      txt = (parsed.text ?? "").trim()
+    } catch { /* non-text content */ }
+    if (txt) {
+      const textKey = `${event.chatId}::${txt}`
+      if (this.textDedup.hasAndMark(textKey)) {
+        console.log(`[wss ${opts.accountId}] text-dedup skip ${event.messageId} ...`)
+        return
+      }
+    }
+  }
```

## 测试

- typecheck **16/16 ✅**
- DedupCache 单测 **19/19 ✅**(复用,不加新测)
- wss-client.ts 集成层不加单测(SDK 内嵌,无现成 fixture,R5 Tiny 例外)
- **真飞书实测**(下次 ship 实地验证):
  - 10s 内连发 2 条同 prompt → 第二条 sidecar log 出现 `text-dedup skip ...`,不进 pipeline
  - 30s 后再发同 prompt → 正常处理(TTL 过期)
  - 同 chat 发不同 text → 不被拦
  - 不同 chat 发同 text → 不被拦

## 验证场景对齐 imbot v2 实测痛点

| 场景 | 改前(imbot v2)| 改后(本笔) |
|---|---|---|
| user 在飞书发"看 ~/.ssh/known_hosts"一次 | 1 张卡 ✅ | 1 张卡 ✅ |
| 飞书 IM 客户端连击 → 后台 2 条独立 message_id | 2 张卡 ⚠️ | 1 张卡 ✅(text-dedup skip) |
| 30s 后 user 主动再发同 prompt | 1 张卡(预期) | 1 张卡(TTL 过期,允许) |
| 同 chat 发不同 prompt | 1 张卡 | 1 张卡(text 不同) |

## 影响范围

- 净改动:1 文件 +27 -1 行
- R4 override:0
- 上游侵入:0(纯 fork-only adapter 层)
- 新单测:0(复用 DedupCache 19 个测试)

## 不改的(scope-limited)

- non-text 类型(image / file / sticker)— 不走 text dedup,messageId+ts 一层够
- 不抽 helper export(直接 inline 在 wss-client handler 里)— 未来撞 bug 再 refactor

## 关联

- 起源:`imbot-permission-pragmatic` 实测中 user 反馈"为什么弹两次"
- 不修 opencode / 上游 SDK(R3 0 黑名单 / R4 0 override)
- 后续 backlog:**D — 卡片显示"本任务第 N 个权限请求"** UX 提示,让 user 心智模型对齐 LLM 多步顺序工作

## FUTURE

- 如果未来仍撞重复 message 问题(超过 10s 但 user 没主动发)— 可加 metadata(send_time) 比较 / TTL 自适应
- 抽 `shouldDedupByText(event, cache): boolean` helper,加 wss-client 集成单测(SDK EventDispatcher mock)
