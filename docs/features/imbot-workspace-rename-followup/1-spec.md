---
feat-id: imbot-workspace-rename-followup
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# imbot-workspace-rename-followup — 1-spec(需求 + 验收 + 测试用例)

## 背景

`imbot-workspace-rename`(2026-05-25 ship 到 main commit `11f6b739e`)落地后,user 实测发现 stale references 残留:

### Bug 复现(user 截图 2026-05-25 16:29)

灵狐🦊-Mac 私聊:
1. user:"把 notes.md 发给我"
2. bot 回复:`⚠️ 发送 /Users/openclaw/.opencode/`**`feishu-workspace`**`/notes.md 失败:ENOENT`(注意:**老路径**)
3. user:"你的workspace地址是什么"
4. bot 回复:`/Users/openclaw/.opencode/`**`feishu-workspace`**(注意:**仍是老路径**)
5. user:"Workspace里面有哪些文件"
6. bot 回复:"该目录目前不存在。你可能需要先向 agent 发送文件,它才会被创建。"

实际:
- `~/.opencode/feishu-workspace/` 已 mv 到 `~/.opencode/imbot-workspace/`(migration 成功,log 验证)
- `~/.opencode/imbot-workspace/notes.md` **真实存在**
- 但 LLM 一直引用老路径 → ATTACH ENOENT + "目录不存在" 误导回复

### 根因分析

`~/.opencode/feishu-chat-sessions.json`(chatSessionStore)里保留了**重命名前**创建的 opencode session ID。这些 session 在 opencode 内部:
- `session.directory` 字段绑死 `~/.opencode/feishu-workspace`(create 时的 path)
- `session.messages[]` 含**老 system prompt**(那时 ATTACH_MARKER_PROMPT 里写的是 `~/.opencode/feishu-workspace/`)
- chat history 也累积了老路径的对话内容

即使 `imbot-workspace-rename` feat 把代码常量 + 新的 promptAsync 调用都改成新路径,**复用老 session ID 时 opencode 仍按老 session 状态走** — 老 system prompt + 老 directory 都还在生效。

→ user 必须每个 chat 手动 `/new` 才能开新 session 用新路径。这个升级体验不能接受(11+ 个 chat,user 不可能一个个 /new)。

### 沿着这个问题排查的其他 stale ref 候选

逐个核查 `~/.opencode/feishu-*` 文件 + opencode session 数据:

| 路径 | stale 类型 | 处置 |
|---|---|---|
| `~/.opencode/feishu-chat-sessions.json` | **session ID 绑老 directory** | ✅ **本 feat 修**(清掉)|
| `~/.opencode/feishu-wss-dedup.json` | 不依赖 directory,只是 messageId 去重 cache | 不动 |
| `~/.opencode/feishu-plugin-server.json` | plugin local server URL,跟 directory 无关 | 不动 |
| `~/.opencode/feishu-config.json` | account credentials,跟 directory 无关 | 不动 |
| **opencode 内部 archived sessions** | 老 session 数据是 orphan(directory 不存在),opencode 自己处理 | 不主动清(GC 走 opencode) |
| **代码层 system prompt** | `ATTACH_MARKER_PROMPT` 等已经在 imbot-workspace-rename 改过 | 不需再动 |
| **active docs**(imbot 定制指南 / ADR / CLAUDE.md) | 都在前 feat 改过 | 不需再动 |

→ 实际只需修 **chatSessionStore**。

## 用户视角(交付物)

### 升级用户(从 `feishu-workspace` 时代过来的 user)

启动 DeskFox(已含本 feat 的版本)→ plugin 启动时检测到"刚做完 workspace rename 还没清过 sessions" → **自动清掉 chatSessionStore** + 写一次性 marker → log "[feishu-plugin] cleared X stale chat sessions after workspace rename"

下次 user 在每个飞书 chat 发消息 → plugin 检测无 chatToSession 映射 → 自动 `session.create({ directory: IMBOT_WORKSPACE })` → 新 session 用新路径 + 新 system prompt → LLM 正确认知 workspace 是 imbot-workspace

**user 体验**:每个 chat 第一条消息会开新对话(失去之前 multi-turn 记忆),但 bot 行为立刻正确。**接受 trade**(memory loss one-time,比 stale path 长期错乱好)。

### 新装用户

marker 文件不存在 + chatSessionStore 也不存在 → 啥都不做,写 marker 防止后续 clean。0 感知。

### 已 /new 过的 user

如果 user 已经手动 /new 过部分 chat(那些 session 是新路径),启动新版本时 marker 不存在 → 仍会**全清**(无差别)。这是 trade — 已 /new 的好 session 也被清,user 多失去几条 chat 的 multi-turn 记忆。

替代设计:**精细识别** session.directory(查 opencode API),只清 stale session — 但复杂度上来,且对 99% 老 user 来说全清更简单。**接受 trade**。

## 验收标准

### 功能

1. ✅ **新加 `applyStaleSessionsCleanup` helper**(`plugin.ts` 内,纯函数 + DI 友好):
   - 输入:`markerPath` / `chatSessionStorePath` / fs / logger
   - 行为:
     - marker 已存在 → no-op
     - marker 不存在 + chatSessionStore 不存在 → 写 marker,no-op
     - marker 不存在 + chatSessionStore 存在 → 清(`unlinkSync`) + 写 marker
     - 异常 → warn,不崩

2. ✅ **plugin `initBackground` 启动时调**:
   - 调用顺序:`migrateLegacyWorkspace` → `applyStaleSessionsCleanup` → `mkdirSync IMBOT_WORKSPACE`
   - 即使 migration 返 "noop-already-new"(user 之前已升级过),仍调 cleanup(marker idempotent)

3. ✅ **marker 文件**:`~/.opencode/.imbot-workspace-rename-cleanup-applied`(隐藏文件,不进任何遍历),内容 JSON `{ "appliedAt": ISO 时间戳, "feat": "imbot-workspace-rename" }`

### 数据 / 不回归

4. ✅ chatSessionStore JSON 不存在 / 空 / 损坏 → 都能 graceful 处理(不崩)
5. ✅ marker 创建失败(权限/磁盘满)→ warn,不崩 plugin
6. ✅ 其他 4 个 feishu-* 文件不动(`feishu-config.json` / `feishu-wss-dedup.json` / `feishu-plugin-server.json` / etc.)
7. ✅ 既有 511/511 测试 0 fail
8. ✅ migration helper 行为不变(本 feat 不改 migrateLegacyWorkspace)

### 安全

9. ✅ `unlinkSync` 失败不抛(plugin 仍能继续启动)
10. ✅ marker 路径用 `~/.opencode/.<filename>` 隐藏文件,不污染 user 视野

### 测试 / 治理

11. ✅ R5 Medium ≥ 5 unit:helper 单测 5+ case(详 §测试用例 T1-T6)
12. ✅ `bun run typecheck` 16/16
13. ✅ 三文档全套 + INDEX + 改动日志 entry

## 测试用例(显式列入 spec,实施后逐一跑过)

### 单元测试:`applyStaleSessionsCleanup`(`__tests__/apply-stale-sessions-cleanup.test.ts`)

| # | case | 输入 | 期望 |
|---|---|---|---|
| T1 | **marker 已存在 → no-op** | markerExists=true,chatStoreExists=任意 | 返 `"noop-already-applied"`,unlinkSync 0 调用,writeFileSync 0 调用 |
| T2 | **marker 不存在 + chatStore 不存在 → no-op + 写 marker** | markerExists=false,chatStoreExists=false | 返 `"noop-no-sessions"`,unlinkSync 0 调用,writeFileSync 调 1 次(写 marker) |
| T3 | **marker 不存在 + chatStore 存在 → 清 + 写 marker** | markerExists=false,chatStoreExists=true | 返 `"applied"`,unlinkSync 调 1 次(传 chatStorePath),writeFileSync 调 1 次(写 marker),logger.info 含 "cleared ... stale chat sessions" |
| T4 | **unlink chatStore 抛错 → failed + warn + 不写 marker** | markerExists=false,chatStoreExists=true,unlinkSync 抛 EACCES | 返 `"failed"`,writeFileSync 0 调用(marker 没写),logger.warn 含 "EACCES" |
| T5 | **写 marker 抛错 → failed + warn**(罕见,unlink 成功但 marker 失败)| chatStore unlink 成功,writeFile 抛错 | 返 `"failed"`,logger.warn 含 marker write error |
| T6 | **真实 fs:legacy state(chatStore 存在,marker 不存在)→ applied** | 真 tmp dir | chatStore 文件被删,marker 文件创建,内容 JSON valid |

### 集成测试:plugin init 流程(`__tests__/plugin-init.test.ts`,新建 OR 集成进现有 plugin 测试)

| # | case | 期望 |
|---|---|---|
| T7 | **plugin initBackground 调用顺序**:`migrateLegacyWorkspace` 先,`applyStaleSessionsCleanup` 后,`mkdirSync` 最后 | order 验证(mock 三者,assert 顺序) |
| T8 | **migration 返 "noop-already-new" 不阻止 cleanup 运行**:user 已升级过(legacy 不存在,new 存在),但 marker 不存在 → cleanup 仍应 run | applied 状态(防漏修已升级 user) |

### 既有测试不回归

| # | case | 验证 |
|---|---|---|
| T9 | `migrate-legacy-workspace.test.ts` 6 个 case 全过 | 不变 |
| T10 | 全套 511/511 case 全过 | 511 + 新加 ~6 = ~517 全 pass |

### 实测验证(Tier 3 本地 + user 手测)

| # | case | 验证手段 |
|---|---|---|
| T11 | **fresh install 模拟**:删 marker + 删 chatStore → 启动 → 验证 marker 写 + chatStore 仍不存在 | `rm -f ~/.opencode/.imbot-workspace-rename-cleanup-applied ~/.opencode/feishu-chat-sessions.json` + 启动 |
| T12 | **升级路径模拟**(当前 user 状态):删 marker + chatStore 含 entries → 启动 → 验证 marker 写 + chatStore 文件被删 | 直接当前状态启动 |
| T13 | **下次启动幂等性**:T12 之后再启动 → 不再清(marker 存在) | 看 log 无 "cleared ... stale chat sessions" 第二次 |
| T14 | **飞书桥接 happy path 真测**:user 私聊 imbot 问"workspace 路径" → 应回 `~/.opencode/imbot-workspace`(不是老路径);"把 notes.md 发给我" → 应成功上传(新路径文件确实存在) | user 手测 |

## 非目标(Out of scope)

- ❌ 精细识别哪些 session 是 stale 哪些是新的(假设全清即可,接受 multi-turn memory loss tradeoff)
- ❌ 改 chatSessionStore 数据结构加版本字段(本次只用 marker 文件)
- ❌ 清 opencode 内部 archived session 数据(opencode 自己 GC)
- ❌ 清其他 `feishu-*` 文件(不需要)

## 安全 / 边界

- **marker 路径隐藏**:`.imbot-workspace-rename-cleanup-applied`(dot prefix)避免污染 ~/.opencode/ ls 输出
- **marker 内容 JSON 结构**:防未来 schema 演进时 parsing,加 `appliedAt` + `feat` 两字段
- **跨平台**:`unlinkSync` / `writeFileSync` 跨 macOS/Linux/Windows 都标准 Node API,无差异
- **race condition**:plugin 启动单次串行,无 race(同 process 内)

## 决策轨迹

- **fix strategy**:**清 chatSessionStore** vs 精细识别 stale session — 选清,简单 + 一次性
- **触发时机**:marker idempotent,unconditional first-run cleanup,无关 migration 返回值(因为 user 可能已升级过 migration 但还没本 feat)
- **不依赖 migration 返回值**:即使 user 已经手动 mv 过路径(罕见)或多次重启,只要 marker 不在就清一次

## 关联

- 上游 feat:`imbot-workspace-rename`(2026-05-25 落地,本 feat 是 follow-up 修升级体验)
- 触动文件:
  - `packages/adapter-feishu-lark/src/plugin.ts`(加 `applyStaleSessionsCleanup` helper + initBackground 调用)
  - `packages/adapter-feishu-lark/src/__tests__/apply-stale-sessions-cleanup.test.ts`(新建,~5-6 case)
- 不动:
  - `migrate-legacy-workspace.test.ts`(本 feat 不改 migration)
  - 其他 `feishu-*` 文件
  - `chat-session-store.ts`(不改实现,只是删文件)
- 关联 docs:本 feat 在 imbot-workspace-rename 3-changelog 加 follow-up 段;ADR 不动

## 实施后必跑测试清单

| # | 测试 | 命令 / 操作 |
|---|---|---|
| C1 | typecheck monorepo | `bun run typecheck` → 16/16 |
| C2-C4 | adapter 套件 + 新加 T1-T6 6 case + T7-T8 集成 2 case | `cd packages/adapter-feishu-lark && bun test` → ~519/519 全过 |
| C5 | T11 fresh install 模拟 | `rm -f ~/.opencode/.imbot-*-applied ~/.opencode/feishu-chat-sessions.json` + 启动 + 验 marker 创建 |
| C6 | T12 升级路径 | 当前状态启动 + 验 chatStore 被删 + marker 写 + log "cleared X stale" |
| C7 | T13 幂等性 | T12 之后再启动 + 验无重复清理 log |
| C8 | T14 飞书桥接 happy path | user 手测 "把 notes.md 发给我" + "workspace 路径是什么" 验回复用新路径 |
| C9 | Tier 3 build | `./packages/branding/scripts/build-deskfox.sh -Env dev` |
| C10 | Rust cargo check | N/A(本 feat 0 Rust 改) |

C1-C2 必须 100% 绿才能 commit;C5-C8 实测让 user 看(C5-C7 我可以本地跑 marker check,C8 user 飞书操作)。
