---
feat-id: feishu-plugin-dedup-decision
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-plugin-dedup-decision — plan

## 决策轨迹

### 1. 初始诊断方向错了(自我修正)

第一次给 user 的 verdict 是"飞书 server 19s 间隔重推同 text 不同 message_id" — 把责任推给飞书 server side。`textDedup` 10s 拦不住 19s,所以"无解,接受现状"。

**user 拒绝**:"不是事后拦截,是要定位到底是哪一层产生第二条,从源头切断"。

### 2. 深查 plugin instance 数

回头扫 sidecar log:`[feishu-plugin] server: http://127.0.0.1:51298/51300/51303` × 3 → **3 个独立 plugin server port**。这不是飞书 server 行为,这是**plugin 真的被加载了 3 次**。

继续往 opencode loader 查:`packages/opencode/src/plugin/loader.ts:122` 的 `await import(row.entry)` — 每个 plugin entry 独立 dynamic import,ES module cache 按物理路径(实际 URL resolve 后)。

查 `~/.config/opencode/opencode.jsonc` 的 plugin 数组 → **4 个 feishu-bridge entry**,3 个物理路径都还在(user 三档开发机切换累积)。

### 3. 飞书 server multi-connection 行为(没真 verify,但合理假设)

3 个独立 WSSClient 同 appId connect 飞书。19s 间隔 + 不同 message_id 解释:**飞书 server 给不同 connection 各推同 user message 时分配不同 envelope,SDK 第一层 dedup 在 instance 间不共享**。

清 jsonc 留 1 entry → relaunch DeskFox → **user 实测双推消失**(2026-05-12)。**假设成立**。

### 4. 长远修法选择 — 元原则 vs 完美主义

讨论过 3 层防御:L1 plugin globalThis singleton / L2 inject 强制单 entry / L3 file lock 跨进程。最初推 L1+L2 组合(承认是 process 级单例 + hygiene)。

**user 反问**:"长远考虑,最优方案是什么?" → "其实同样一个用户,装多个版本的可能性都不大"。

承认 user 是对的:
- prod 用户**99% 单装不切档** → 永远 1 entry → 永远 1 instance → 永远不撞
- 修代码引入的债 / 风险 / 维护负担 > 它换来的"防一个不会发生的场景"

**最终决策:产品代码不做防御,开发机问题用 build script 兜底,把决策显式写下防未来 agent 又踩坑**。

### 5. 三个动作

| 动作 | 文件 | 行数 | 目的 |
|---|---|---|---|
| 加决策注释 | `feishu_plugin_install.rs` | +15 | 防未来 agent 重复实施 L1/L2/L3 |
| 加 post-build 清 jsonc | `build-deskfox.sh` | +20 | 开发机污染兜底 |
| 同步 Win 端 | `build-deskfox.ps1` | +20 | 双端对称,Win 开发机一样可能撞 |

### 6. 不撤回 dedup-cache-persist

`dedup-cache-persist` 解决的是**单 instance 场景下 sidecar 重启后飞书 server 重推同 message_id**(跨进程 persist + reload skip)。**跟本笔 multi-instance 是不同层问题**,不冲突,留着。实测 2026-05-12 08:22 验证 dev 启动后那条 om_x100b6f13598d18b4b100632d8b877df 确实被 reload 拦下。

### 7. 不撤回 wss-text-dedup

同理,`wss-text-dedup` 解决的是**单 instance + 飞书 IM 客户端连击 retry 10s 内发出不同 message_id 同 text**(IM 客户端层级问题,跟 multi-instance 无关)。留着。

## 顺序

1. 给 user 清 jsonc 让 user relaunch DeskFox 验证 → 假设成立(user 反馈"发两次消息的问题已经解决了")
2. 开 chore 分支 `chore/feishu-plugin-dedup-decision`
3. 加 `feishu_plugin_install.rs` 头注释
4. 加 `build-deskfox.sh` post-build 清理 + 本地 fixture 模拟通过
5. 同步 `build-deskfox.ps1`(Win 端对称)
6. 写三文档 + INDEX + 改动日志
7. commit on chore 分支 + 请示 user 合 dev + push

## 不做

- L1 plugin globalThis singleton(可行但 user 拍板不做)
- L2 inject 强制单 entry(同上)
- L3 file lock(同上)
- 不撤 `dedup-cache-persist` / `wss-text-dedup`
- 不动 `plugin.ts` module-level state(它现在长这样就正常 work,不动)

## 关联

- 起源:user 实测仍撞双推 + 拒绝"事后拦截"哲学 → 深查 plugin instance 数 → 定位 jsonc 累积
- 不撤但相关:`dedup-cache-persist`(独立问题层)/ `wss-text-dedup`(独立问题层)
- 未来 backlog:auto-update / beta 公测前评估 L1/L2/L3
