---
feat-id: imbot-workspace-rename-followup
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# imbot-workspace-rename-followup — 3-changelog(实际改动 + 回归)

## commit 链

| # | hash | 说明 |
|---|---|---|
| 1 | `39a9b2760` | docs: 1-spec + 2-plan + INDEX entry |
| 2 | `c8f3b2434` | feat: `applyStaleSessionsCleanup` helper + initBackground 接入 + 6 单测 |
| 3 | (本笔) | docs: 3-changelog + INDEX status `spec` → `done` + 改动日志.md entry |

## 行数 / 文件

净 +280 行 / 2 文件:
- `packages/adapter-feishu-lark/src/plugin.ts` +111 / -1
- `packages/adapter-feishu-lark/src/__tests__/apply-stale-sessions-cleanup.test.ts` +169(新建)

## 改动详情

### `plugin.ts`

1. 加 `unlinkSync` import(原已有 `existsSync` / `writeFileSync` / `renameSync` 等)
2. 加常量 `STALE_SESSIONS_CLEANUP_MARKER` = `~/.opencode/.imbot-workspace-rename-cleanup-applied`
3. 加常量 `CHAT_SESSION_STORE_PATH` = `~/.opencode/feishu-chat-sessions.json`(跟 `feishu/chat-session-store.ts` 的 `STORE_PATH` 同地址,本 feat 不改 file 名 — 它确实是 feishu plugin specific,跟 home base 是不同概念)
4. 导出 `CleanupResult` type(`applied` / `noop-already-applied` / `noop-no-sessions` / `failed`)
5. 导出 `applyStaleSessionsCleanup(markerPath, chatSessionStorePath, fs, logger)` helper(40 行,DI 友好):
   - marker 存在 → `noop-already-applied`(idempotent 守门)
   - marker 不存在 + chatStore 不存在 → 写 marker → `noop-no-sessions`(首装用户)
   - marker 不存在 + chatStore 存在 → unlink chatStore + 写 marker → `applied`(升级用户)
   - unlink fail → warn + 返回 `failed` 不写 marker(下次启动重试)
   - 写 marker fail → warn + 返回 `failed`
6. `initBackground` 内 `migrateLegacyWorkspace` 后 `mkdirSync` 前接入调用(7 行)

### test file(新建)

T1-T6 6 个用例覆盖行为表 + 异常路径 + 真实 fs:
- T1: marker 已存在 → `noop-already-applied`,无 fs side effect
- T2: marker 不存在 + chatStore 不存在 → `noop-no-sessions` + 写 marker
- T3: marker 不存在 + chatStore 存在 → `applied` + unlink + 写 marker
- T4: unlink 抛 EACCES → `failed`,warn 含 "EACCES" 和 "failed to clear stale chat sessions",**不写 marker**(下次还会重试)
- T5: 首装 + 写 marker 抛 ENOSPC → `failed`,warn 含 "ENOSPC" 和 "failed to write cleanup marker"
- T6: 真实 tmp fs 集成 — 写一个真 chatSessionStore.json → 调 helper → 验证文件被 unlink + marker 创建 + marker JSON 内容含 `feat: "imbot-workspace-rename"` 和 `appliedAt`

## 回归测试 / 验收

### C1 typecheck
`bun run typecheck` → **16/16 通过** ✓

### C2-C4 adapter test suite
`bun test packages/adapter-feishu-lark/` → **517 pass / 0 fail / 1013 expect / 20 files / 3.58s**
基线 511(`imbot-workspace-rename` 收尾)+ 新 6 = 517 ✓

### C5-C8 验证

**C8 user 真飞书 IM 实测 ✓ 已过**(2026-05-25,user 私聊"把 notes.md 发给我",bot 用新路径 `~/.opencode/imbot-workspace/notes.md` emit ATTACH 成功,问"workspace 地址"答新路径)。

**C6 user 真实环境间接验证 ✓ 已过**:user 装新 .app 启动后 `~/.opencode/.imbot-workspace-rename-cleanup-applied` 文件存在,内容 `{"appliedAt":"2026-05-25T09:32:50.081Z","feat":"imbot-workspace-rename"}`,JSON valid,且 chatSessionStore 在 marker 后 1 分钟被重新创建(新 session,proves cleanup 触发过)。

**C5 + C7 集成 probe ✓ 已过**:`packages/adapter-feishu-lark/scripts/probe-cleanup-integration.ts` 在 tmp 真实 fs 跑三路径(不动 user 真实 ~/.opencode),17/17 通过:
- C5 首装(空目录)→ `noop-no-sessions` + marker 写入 + chatStore 未被创建
- C7 幂等(marker 已存在 + 故意造 stale chatStore)→ `noop-already-applied` + chatStore **未被误删** + marker mtime **未变**(没 rewrite,证明真 idempotent)
- bonus C6(无 marker + 有 chatStore)→ `applied` + chatStore 被清 + marker 创建

Probe 是 `scripts/probe-feishu-oauth.ts` 同款集成验证工具,留作未来 regression check。

跑法:`bun run packages/adapter-feishu-lark/scripts/probe-cleanup-integration.ts`

### C9-C10
- C9 Rust cargo check:无引用 plugin.ts 内容,跳过(本 feat 0 Rust 改动)
- C10 0 R4 override:已确认,均走 fork-only 新增 / 既有 fork-only 文件追加

## 影响范围

- **plugin.ts**:启动多 1 步幂等 cleanup(O(1) fs 操作 + 1 个文件 unlink),启动后整个会话生命周期不再涉及
- **users**:
  - 首装:0 影响(只多写一个 marker 文件)
  - 已用 user(升级):**一次性失去** chat multi-turn memory(opencode session ID 重建)。1-spec 已论证 trade off:换掉短期 memory 损失换长期路径正确性,比手动 `/new` × 11+ chat 体验好
- **测试**:+6 case / +169 行,集中在 1 个新测文件,不动既有测试

## 回退方法

```bash
git revert c8f3b2434
```

或人工:
- plugin.ts 去掉 `applyStaleSessionsCleanup` 函数 + 2 个常量 + initBackground 调用 + import 里 `unlinkSync`
- 删 test 文件

回退后已经被清掉的 chatStore 不会自动恢复(user 损失 multi-turn memory)但功能不损坏 — 重新建 session 仍走新路径(因 `imbot-workspace-rename` 已在 main)。

## Phase 1 e2e

本 feat 是 sidecar 启动期 init helper,**不触 view layer / 不进 Phase 1 mock-mode 覆盖范围**。R5 v4 e2e gate 要求"main push 时所有 spec 必须过",仍走既有套件(0 新增 e2e)。

## 实施时长

约 80 分钟(spec 25 + plan 15 + impl 15 + 测试 15 + 验证 + 文档 10)。Medium- 实际,符合预期。
