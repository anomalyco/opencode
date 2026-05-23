---
feat-id: feishu-pipeline-401-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-pipeline-401-fix — 1-spec(飞书桥接 reply 全静默修复)

> **状态**:✅ 已落地(2026-05-23)
> **分支**:`feat/feishu-pipeline-401-fix`
> **来源**:user 反馈「我通过飞书给 DeskFox 发的消息没有回复」(2026-05-22 23:30)

---

## 1. 现象 & 触发原因

### 用户视角

打开飞书,给 DeskFox 机器人发消息(任意,如「你是哪个模型？」)→ DeskFox 端**完全没有任何回复**。机器人 emoji ack(消息已收到)正常显示,但文字 reply 永远不到。

### 实测复现路径

`~/Library/Logs/ai.deskfox.app/opencode-desktop_*.log` 内 pipeline 日志:

```
23:13:22  msg from chat=oc_f903...: "你是哪个模型？"     ← WSS 收到
23:13:23  new opencode session ses_... (archived,持久化) ← 建 session 成功
23:13:33  messages fetch failed status=401, fallback ""  ← ❌ 拉 messages 401
23:13:33  empty reply for chat=oc_f903...                 ← reply 返空 → 飞书没收到
```

`message-pipeline.ts:318` 调 `opencodeClient.session.messages({...})`,SDK 走 `GET /session/{id}/message`,sidecar 返 401 空体 → pipeline 判 `!wrap.data` 返 `""`(`message-pipeline.ts:256`)。

3 条今天的飞书消息(23:13 / 23:25 / 23:27),3 条 401 + 3 条 empty reply,模式 100% 复现。

## 2. 根因(三层叠加)

### 2.1 Sidecar 编译期 CHANNEL=dev → HTTPAPI 默认 ON

`packages/script/src/index.ts:30` build sidecar 时读 `git branch --show-current` 作为 fallback `OPENCODE_CHANNEL`。2026-05-21 前 Mac 主分支叫 `dev` → sidecar baked CHANNEL=`dev` → 命中 `HTTPAPI_DEFAULT_ON_CHANNELS = Set(["dev", "beta", "local"])`(`packages/core/src/flag/flag.ts:16`)→ 上游 effect-httpapi stack ON。

### 2.2 effect-httpapi v1 messages 路径 bug 1:多 security AND 实现导致 401

`packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts`:
```ts
security: {
  basic: HttpApiSecurity.basic,
  authToken: HttpApiSecurity.apiKey({ in: "query", key: "auth_token" }),
}
```

Effect HttpApi 把 `{basic, authToken}` 当**逻辑 AND**(两个 scheme 都必须 pass),不是预期的 OR。SDK / curl 只带 Authorization: Basic header → basic pass + authToken 收空 credential → 失败 → 整个 endpoint 返 401 空体(`UnauthorizedNoContent` 兜底)。

### 2.3 effect-httpapi v1 messages 路径 bug 2:StepFinishPart.reason 必填编码失败 → 400

`packages/opencode/src/session/message-v2.ts:266` 的 `StepFinishPart` schema 要求 `reason: Schema.String`(必填)。但 `packages/opencode/src/session/processor.ts:475` 的 writer 直接写 `reason: value.finishReason`,当 LLM API(ClaudeCode plugin 等)未返 finishReason 时该字段写入 `undefined` → JSON 序列化丢字段 → DB 缺该 key → 读回时 Schema encode 失败 → endpoint 返 400 空体。

> Bug 1 + Bug 2 是同一路径(effect-httpapi v1 messages)的双重故障 — 即使把 1 修了,2 仍然吐 400;反之亦然。验证日志:`[diag-msg-step] item[1] FAIL msg=Missing key at ["parts"][2]["reason"]`。

### 2.4 Hono legacy 路径不撞两个 bug

HTTPAPI OFF 时,`/session/X/message` 走 `packages/opencode/src/server/routes/instance/session.ts:619` 的 Hono handler,直接 `c.json(messages)` 序列化,**不做 Schema encode**,Bug 2 不触发;auth 也走 Hono `basicAuth`(单 mechanism 内置 fallback),Bug 1 也不触发。

### 2.5 Win 端为什么不复现

Win 端 build sidecar 时 git branch 大概率非 `dev`(可能是某个 feat 分支),baked CHANNEL=分支名(不在 `[dev, beta, local]` 集合内)→ HTTPAPI OFF → 走 Hono legacy → 两个 bug 全规避。**Win 用户其实"瞎猫碰死耗子"地走对了路径**,不是 Win 端代码不一样。

> Mac vs Win 不一致的根本原因是 sidecar baked CHANNEL 漂移,而不是平台差异。

## 3. 验收标准

| # | 标准 | 验收方式 |
|---|---|---|
| V1 | `GET /session/{id}/message?directory=...` 200 OK 返 messages 数组 | curl 直测 |
| V2 | `GET /session/{id}/message/{messageID}` 200 OK 返单条 message | curl 直测(含 assistant role,验 StepFinishPart 编码不挂)|
| V3 | 无 auth → 401(安全回归) | curl 不带 -u |
| V4 | 错 password → 401(安全回归) | curl -u opencode:WRONG |
| V5 | `auth_token` query auth 仍 work(WebSocket 路径) | curl 带 `auth_token=base64(user:pass)` |
| V6 | `/session list` 仍能列出所有(包括 archived)session(回归) | curl `/session?directory=feishu-workspace` |
| V7 | DB 迁移:user 升级后 GUI session list 仍看得到历史 session | 模拟 prod 1.14.33 用户:删 `opencode.db`,留 `opencode-dev.db` → 起 Dev.app → log 应有 `[fork-db-migrate] done`,GUI 仍看到原 session |
| V8 | 迁移幂等:重启 N 次只跑 1 次,源文件保留 | rust unit test |
| V9 | 飞书 e2e:发消息 → 收到 reply | user 飞书实测 |

## 4. 架构选型(为什么走方案 A 而不是 B/C)

### 方案对比

| 方案 | 改动量 | R4 黑名单 override | 风险 |
|---|---|---|---|
| **A:build script 锁 CHANNEL=prod**(选)| 3 文件 / ~30 行 | **0** | DB 文件改名副作用 → 配 lib.rs 一次性迁移 hook 解决 |
| B:fork 修上游 schema + auth 两个 sub-bug | 2 上游文件 | **2 笔**(季度配额吃满)| 改 schema 风险面大,reason optional 可能漏掉其他 part 类型类似问题 |
| C:pipeline 改 dispatcher 累积 + role 过滤 | 2 plugin 文件 / ~80 行 + 测试 | 0 | 上游 bug 留着,后续别处再撞;dispatcher echo 修法本身复杂 |

### A 的优势

1. **跟 Win 端 + 上游 prod 用户体验对齐** — Hono legacy stack 是上游 stable 用户跑的同一条路径,我们等于回到稳定通道
2. **0 override** — 不动 `packages/opencode/`(R1 元原则:**改上游侵入率最小化**)
3. **Bug 1 + Bug 2 一击双收** — 走 Hono 编码不调 Schema,两个 sub-bug 全规避
4. **可逆** — 后续上游 effect-httpapi 稳定后,移掉 build script 一行 `export OPENCODE_CHANNEL=prod` 即可回 dev channel

### A 的代价

`getChannelPath()`(`packages/opencode/src/storage/db.ts:30`)对 `prod` channel 用 `opencode.db`,对其他 channel 用 `opencode-<channel>.db`。Mac prod 1.14.33(channel=dev)用户的数据在 `opencode-dev.db`,升级到本 fix 后 sidecar 改读 `opencode.db` → GUI session list 空。

补救:`packages/desktop/src-tauri/src/lib.rs` 加 `migrate_pre_prod_db()` 一次性幂等迁移 hook(initialize() 头部),`opencode.db` 不存 + `opencode-dev.db` 存 → cp 3 文件(`.db` / `.db-wal` / `.db-shm`),旧文件保留作回退兜底。带 6 个 unit test。

## 5. 不在本 feat 范围

- **上游 schema/auth 两个 sub-bug 不修** — 推到上游待修(或下次决定 dogfood effect-httpapi 再处理)
- **dispatcher echo bug 不修** — pipeline 还在用 `session.messages` 拉 role 准确 reply,echo bug 不上桌面
- **`opencode-<branch>.db` 系列不删** — 历史 build 留下的多个 channel DB 文件保留,user 想清可手动删

## 6. ship 影响面

- **Mac prod 1.14.33 用户**:升级后含本 fix 的版本,首次启动自动迁移 DB,**无感知**。GUI session list / 飞书桥接两路都正常
- **Mac dev 5.21.1-dev 预览用户**:同上(channel=dev → 升级到 channel=prod,同样触发迁移)
- **新装用户(无任何旧 DB)**:迁移 hook skip,直接用 fresh `opencode.db`
- **Win 用户**:理论上 Win 端 baked CHANNEL 漂移,但 prod 通常是 channel=feat 分支名 → 已经走 Hono 路径,本 fix 让 channel=prod 后**更一致**,DB 路径也可能切到 `opencode.db`,迁移 hook 同样兜底