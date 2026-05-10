---
feat-id: feishu-server-loopback-bind
status: done
related: ./3-changelog.md
---

# feishu-server-loopback-bind — changelog

## 一句话

修飞书桥接 plugin server 默认绑 `0.0.0.0` 暴露 LAN 端口的安全 + UX 双 bug — `Bun.serve()` 没传 `hostname`,Bun 默认绑所有网卡,触发 Win Firewall 弹"是否允许 Bun 公网访问"对话框,同时把 plugin server 暴露给同 WiFi 任何人(虽有 basic auth 但攻击面应归零)。1 行 fix 加 `hostname: "127.0.0.1"`。

> Tiny:1 文件 / 5 行 / 0 R4 / 0 上游侵入。

## commit 列表

| commit | 简述 |
|---|---|
| `0fe4e2984` | `fix(feishu-bridge): plugin server bind 127.0.0.1 only,告别 Win Firewall "Bun" 弹窗`(主笔)|

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/adapter-feishu-lark/src/server.ts` | +5 行 | `Bun.serve` config 加 `hostname: "127.0.0.1"` 一行 + 4 行注释解释 |

## 背景

2026-05-10 user 反馈装完 DeskFox 后弹出"是否允许公共网络和专用网络访问此应用?"对话框,显示发行者 Oven、程序名 Bun(opencode-cli 用 Bun.compile 打的 exe,publisher 字段是 Oven 公司),user 不知道 Bun 是啥看起来像恶意软件。

审计发现 `packages/adapter-feishu-lark/src/server.ts:461` 的 `Bun.serve({port, fetch})` 没传 `hostname`,Bun 默认 `"0.0.0.0"`(所有网卡)。URL 文件里写的 `127.0.0.1:${port}` 误导,**实际监听是全网卡**。

## 影响

| 维度 | 修前 | 修后 |
|---|---|---|
| Win Firewall 弹窗 | 必弹 1 次 | Win10/11 大多数版本不再弹(loopback bind 不进 inbound 防火墙路径)|
| LAN 可达性 | 同 WiFi 任何人都能扫到端口(虽有 basic auth 拦截 API 调用,但端口暴露本身就不该)| 仅 127.0.0.1 可达,LAN 0 暴露 |
| 安全攻击面 | 同 WiFi 设备可探测端口 + 尝试 brute force basic auth | 归零 |

## 修法

`packages/adapter-feishu-lark/src/server.ts` `Bun.serve` config 加一行:

```diff
  const server = Bun.serve({
    port: options.port ?? 0,
+   hostname: "127.0.0.1",
    fetch: handler,
  })
```

加 4 行注释解释为何必须显式 loopback(默认 0.0.0.0 触发的两个 bug)。

## R5 测试

`server.test.ts` 19 单测仍全 pass(测试用 client 走 127.0.0.1 跟生产一致,bind hostname 改不影响测试通路)。无需新增专项测试。

## 实测验证

user 删 Win Firewall 缓存的 block 规则后启动新 build:零防火墙弹窗。

## 沉淀 — 防再犯

新加 R6 governance 规则 + pre-commit §4.5 闸,详见 `feishu-bridge-empty-reply-ghost` 不,见独立 feat [`network-bind-safety-guard`](../network-bind-safety-guard/3-changelog.md)。

## R4 / 上游侵入

- 0 R4 override
- 0 上游侵入(改 fork-only `adapter-feishu-lark/src/server.ts`)
