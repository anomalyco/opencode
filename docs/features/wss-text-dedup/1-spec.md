---
feat-id: wss-text-dedup
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# wss-text-dedup — spec

## 一句话

`wss-client.ts` 在 SDK 内置 dedup(`messageId+ts`)之后加**第二层 short-term text dedup**(同 chatId+text 10s 内重复 skip),防飞书 IM 客户端连击 / retry 推**不同 message_id 但内容一致**的多条消息触发 LLM 重复执行 + 弹多张权限卡。

## 起源

`imbot-permission-pragmatic` v2 实测中,user 在飞书发"看一下我的 ~/.ssh/known_hosts 文件",sidecar log 显示**两条独立 user message**:
- 11:27:02 → user msg id `msg_e17a61c07001lYFELGET7IUekB`,弹 external_directory 卡,reject
- 11:27:21 → user msg id `msg_e17a66460001ptJhI6epnXaEYY`,**又**弹 external_directory 卡,reject

User 否认手动发了 2 次,但 message_id 不同 = 飞书后台真有 2 条独立 message。SDK 内置 dedup 按 messageId+ts 拦,**这两条 messageId 不同,拦不住**。

可能根因:
- 飞书 IM 客户端连击 / 网络抖动 retry(user 不察觉)
- 飞书后台分配了新 message_id(SDK dedup 失效)

## 范围

`packages/adapter-feishu-lark/src/feishu/wss-client.ts` 加第二层 dedup:

```ts
private readonly textDedup = new DedupCache({ ttlMs: 10_000, maxEntries: 200 })

// 在 SDK messageId+ts dedup 之后,chatQueue 之前:
if (event.messageType === "text") {
  let txt = ""
  try {
    const parsed = JSON.parse(event.content) as { text?: string }
    txt = (parsed.text ?? "").trim()
  } catch { /* 非 text 内容 → 不走 text dedup */ }
  if (txt) {
    const textKey = `${event.chatId}::${txt}`
    if (this.textDedup.hasAndMark(textKey)) {
      console.log(`[wss ${opts.accountId}] text-dedup skip ${event.messageId} ...`)
      return
    }
  }
}
```

- 复用现有 DedupCache 类(无新代码),只是配置 `ttlMs=10_000` + `maxEntries=200`
- 只对 `messageType === "text"` 生效(image / file / sticker 等不走)
- key = `${chatId}::${trimmedText}` — 同 chat 同内容 10s 内第二条 skip

## 验收

- typecheck 16/16(已过)
- DedupCache 19/19 单测过(复用现有,本笔不加新单测)
- 真飞书实测:user 在 10s 内连发 2 条同 prompt → 第二条 sidecar log `text-dedup skip ...`,不进 pipeline

## 不做

- **不引入新 DedupCache 类** — 复用现有
- **不做 plugin 端 wss/cache E2E test** — wss-client.ts 内嵌 SDK EventDispatcher,没现成 test 基础设施;DedupCache 行为已单测覆盖
- **不对 non-text 类型 dedup**(image / file 等)— 这些飞书后台不会乱推,messageId+ts 第一层够用

## 规模

Tiny — 1 文件 +27/-1 行,0 新单测(复用 DedupCache),0 R4,0 上游侵入。
