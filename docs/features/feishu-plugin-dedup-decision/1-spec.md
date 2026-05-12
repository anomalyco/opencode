---
feat-id: feishu-plugin-dedup-decision
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-plugin-dedup-decision — spec

## 一句话

把"opencode.jsonc 累积多个 feishu-bridge plugin entry → multi-instance → 双推 user message"的根因诊断 + **不做产品层防御**的决策**显式写下**,顺手加 `build-deskfox.{sh,ps1}` post-build 清开发机污染,在 `feishu_plugin_install.rs` 头加段决策注释防未来 agent 重复实施防御代码。

## 起源(2026-05-12 user 实测)

`imbot-permission-pragmatic` v2 + `wss-text-dedup` + `dedup-cache-persist` 三个 feat 落定后,user 实测仍撞 "发一条 IM 但 bot 弹卡两次"。投入排查:

### 现象链

```
sidecar log:
  17:05:04 msg "OpenCode有没有...邮件" → 弹 webfetch 卡片 #1
  17:05:23 msg "OpenCode有没有...邮件" (同 text,不同 message_id) → 弹卡片 #2
```

- 飞书 IM 端 user 只看到自己发了 **1 条**
- 间隔 19s 超 `wss-text-dedup` 10s 窗口拦不住
- `dedup-cache-persist` 拦的是同 message_id 重推,不同 id 拦不住

### 真凶定位

sidecar log 头部:
```
[feishu-plugin] server: http://127.0.0.1:51298
[feishu-plugin] server: http://127.0.0.1:51300
[feishu-plugin] server: http://127.0.0.1:51303
[wss] connected: account=cli_a969b99e42221bcd × 3
[feishu-plugin] synced: WSS=1/1 pipelines=1 × 3
```

3 个独立 plugin server port + 3 次 wss connect 同 appId。查 user `~/.config/opencode/opencode.jsonc`:

```jsonc
"plugin": [
  "file:///Volumes/ExtSSD/.../DeskFox Dev.app/.../feishu-bridge",      // 空格
  "file:///Volumes/ExtSSD/.../target/release/plugin/feishu-bridge",    // raw target
  "file:///Applications/DeskFox.app/.../feishu-bridge",                // prod
  "file:///Volumes/ExtSSD/.../DeskFox%20Dev.app/.../feishu-bridge"     // %20 编码
]
```

**4 个 entry 物理文件都还在**(user 三档开发机来回切换累积)。`feishu_plugin_install::inject_plugin` 当前的去重逻辑(`path_still_valid` 判路径是否还在)只处理"路径失效"场景,**不处理"同 plugin 多个并存物理路径"**,4 entry 全保留。

opencode loader 并发 `import` 4 entry:
- entry 1(空格)≡ entry 4(%20)→ file:// URL 不同字符串但物理路径相同,ES module cache 共享 → 1 instance
- entry 2 raw target → 不同物理路径 → 独立 instance
- entry 3 /Applications → 不同物理路径 → 独立 instance
- **= 3 instance**(跟 log 3 个 port 对应)

每个 instance 起独立 plugin server + 独立 WSSClient.start() 同 appId connect 飞书。飞书 server 对 multi-active connection 的行为是给不同 connection 推同 user message 时**分配不同 envelope/message_id**,SDK 第一层 dedup(message_id+ts)在每个 instance 内独立不共享 → 同 user 一条 IM 被两个 instance 各 process 一次,bot 弹两张卡。

## 决策 — 不做产品层防御

| 方案 | 治啥 | 改动 | 决策 |
|---|---|---|---|
| L1 plugin process-level singleton(`globalThis`)| 多 import 同进程多 instance | plugin.ts 顶层挪 globalThis ~20 行 | **不做** |
| L2 inject 强制单 entry(改 retain 逻辑)| jsonc 累积 | feishu_plugin_install.rs 改 ~10 行 + 单测 | **不做** |
| L3 file lock 跨进程 singleton | beta+prod 真同跑 | 新加 ~50 行 lock 处理 + stale 检测 | **不做** |

理由(元原则"稳定 > 简洁 > 一切" + "避免业务无限扩大"+ R1 三级跳):

1. **普通用户不撞** — 单装 prod / 不动安装位置 / 不切档 → opencode.jsonc 永远 1 entry → 1 instance → 不可能双推
2. **开发机问题用 build script 兜底** — `build-deskfox.{sh,ps1}` 加 post-build 清 jsonc 多余 feishu-bridge entry,下次 DeskFox 启动 setup hook 自然 inject 当前 .app(单 entry 状态)
3. **边界场景(auto-update 路径变化 / beta+prod 同跑)等真触发再评估** — 不预先实施防御代码,避免技术债换无价值场景的"防御"

## 范围

### A. `packages/desktop/src-tauri/src/feishu_plugin_install.rs` 文件头加决策注释

明确写出"不做'同 plugin 多物理路径'清理"+ 理由 + 未来候选方案(L1/L2/L3)。

**目的**:防未来某个 agent 或我自己重新踩同一个坑、又写一遍防御代码。

### B. `packages/branding/scripts/build-deskfox.sh` + `build-deskfox.ps1` 加 post-build 清 jsonc

`build` 成功后顺手扫 `~/.config/opencode/opencode.jsonc`(Win:`%USERPROFILE%\.config\opencode\opencode.jsonc`),若 `plugin/feishu-bridge` 子串出现 >1 次,清掉所有相关 entry(下次 DeskFox 启动 setup hook 自动 inject 当前 .app)。

- 备份原文件到 `.bak.build-cleanup`
- 处理悬空逗号(`,\n  ]` → `\n  ]`)— Mac 用 `perl -i -0pe`,Win 用 `[regex]::Replace`
- 单 entry / 0 entry 时不动

### C. 三文档落盘 + INDEX + 改动日志

按规范 v2 走完整流程,Tiny 规模(< 50 行代码 + 文档)。

## 验收

- ✅ 文件头注释让"为什么不做"5 行内说清,未来 agent 一眼能看懂
- ✅ `bash -n build-deskfox.sh` 语法通过
- ✅ 本地模拟跑清理函数 fixture(3 entry → 0 entry,JSON 合法,其他 agent / provider entry 保留)
- ✅ user 手动清自己 jsonc + relaunch DeskFox → 双推消失(已验证 2026-05-12)

## 不做

- L1/L2/L3 三层防御代码(理由见决策段)
- Mac 端 ship Gitee 镜像同步(Mac 端 ship 流程已收敛只到 GitHub Release,无关本笔)
- dedup-cache-persist / wss-text-dedup 撤回(对 sidecar restart / 10s 内连击仍有用,留着)

## 规模

Tiny — Rust 注释 +15 行 / sh post-build +20 行 / ps1 post-build +20 行 / 三文档 + 索引。

## 关联

- 起源:`imbot-permission-pragmatic` v2 + `wss-text-dedup` + `dedup-cache-persist` 实测后仍撞双推 → 深查根因到 plugin multi-instance
- **不撤回但相关**:`dedup-cache-persist`(A 方案 — 拦 sidecar 重启后飞书 server 重推老 message_id,跟本笔 multi-instance 是不同层问题)
- 不做但留 backlog:auto-update / beta 公测前再评估 L1/L2/L3
