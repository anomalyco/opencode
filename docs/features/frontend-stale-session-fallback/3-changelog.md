---
feat-id: frontend-stale-session-fallback
status: done
related: ./3-changelog.md
---

# frontend-stale-session-fallback — changelog

## 一句话

`directory-layout.tsx` 启动恢复 session 路径加 catch — sidecar 401/404 时 navigate 去掉 stale session id 降级到主界面,不让 ErrorBoundary 兜底渲染 5.21.x ship 撞死的"出了点问题"错误页;接力 [`sdk-falsy-empty-body-fix`](../sdk-falsy-empty-body-fix/3-changelog.md) 把 surface fix 推到产品级闭环。

> Tiny+ / Medium 边界 — 3 新 1 改 文件(helper +25、test +60、directory-layout +35、docs)/ 10 单测全过 / 0 R4 / 0 上游侵入。

## 起源(2026-05-21 5.21.1-dev Mac 首次 Tier 2 ship 翻车 follow-up)

[`sdk-falsy-empty-body-fix`](../sdk-falsy-empty-body-fix/3-changelog.md) 让错误信息 surface — user 看到的从 "Unknown error / 原因: {}" 变成 "Server returned 401 with empty body: http://127.0.0.1:.../session/ses_xxx/message?...",**bug 看得见了**。但根本问题仍在:**有 dev 历史的用户**(本机 `~/Library/Application Support/<bundle>/opencode.workspace.*.dat` 累积了引用 stale session id 的 workspace state)装 5.21.1-dev 启动恢复时**仍会撞 ErrorBoundary**。

普通用户(首装)不撞 — 没 stale state。但升级路径必须修。

## 触发链(已确诊)

```
Tauri webview 启动 → 恢复上次 URL `/<directory_base64>/session/<stale_id>`
  ↓
DirectoryDataProvider (directory-layout.tsx) mount
  ↓
createResource(() => params.id, (id) => sync.session.sync(id))   ← 启动恢复路径
  ↓
sync.session.sync(stale_id) → 内部调 client.session.messages({ sessionID: stale_id, ... })
  ↓
sidecar GET /session/ses_xxx/message?... → 不识 → 401 + empty body
  ↓
wrapFetchWithFalsyGuard layer 2 抛 Error("Server returned 401 with empty body: ...")
  ↓
SDK retry chain → Promise.all reject → sync.session.sync reject → createResource fetcher reject
  ↓
SolidJS 顶层 ErrorBoundary 渲染"出了点问题 / 加载应用程序时发生错误"
```

实际验证:user 装 5.21.1-dev 后 mv 走 `~/Library/Application Support/ai.deskfox.app.dev/` 干净启动**完全正常**,主界面渲染。回填 stale state 必撞。

## 修法

### 哲学

**只在启动恢复路径(directory-layout.tsx createResource)兜底,不动 sync.session.sync 内部**。理由:
- 其他 caller(`message-timeline.tsx:458` user 点击老 session 卡时主动 sync / `session.tsx:782` user 进入 session 详情页 stale 时 refresh)拿到 stale error 时,他们期望 surface 错误(toast / 弹窗)而不是静默 navigate。
- 启动恢复路径的语义独特:user 没主动选这个 session,是 router URL 自动恢复带来的,降级到主界面对 user 是合理 UX。

### 改动

**新 helper `packages/app/src/utils/stale-session-error.ts`**(+25 行):

```typescript
export function isStaleSessionError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  // [feat: sdk-falsy-empty-body-fix] wrapFetchWithFalsyGuard layer 2 抛的格式:
  //   "Server returned 401/404 with empty body: <url>"
  if (/^Server returned 40[14] with empty body:/.test(e.message)) return true
  return false
}
```

只识别 401/404。**5xx 不视为 stale**(可能是 sidecar 临时挂,user retry 应能恢复 — navigate 走会让 user 丢上下文)。**403 暂不展开**,需求出现再扩 regex。

**改 `packages/app/src/pages/directory-layout.tsx` createResource fetcher**(+25/-3):

```typescript
createResource(
  () => params.id,
  async (id) => {
    try {
      return await sync.session.sync(id)
    } catch (e) {
      if (isStaleSessionError(e)) {
        console.warn("[stale-session-fallback] navigate away from stale session", { sessionId: id, error: ... })
        navigate(`/${slug()}`, { replace: true })
        return
      }
      throw e  // 其他错误正常 surface 给 ErrorBoundary
    }
  },
)
```

`navigate(.../, { replace: true })` 用 directory 根 URL 替换当前 session URL,Tauri webview 下次启动也不会再恢复到 stale session id。

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/app/src/utils/stale-session-error.ts` | 新建 +25 行 | helper `isStaleSessionError`,识别 wrapFetchWithFalsyGuard 抛的 401/404 |
| `packages/app/src/utils/stale-session-error.test.ts` | 新建 +60 行,10 单测 | 401/404 → true,500/403/network/AbortError/non-Error → false,SDK body 非空 → false,subclass(TypeError)支持 |
| `packages/app/src/pages/directory-layout.tsx` | +30/-3 | createResource fetcher 加 try/catch + navigate-on-stale,FORK marker |
| `docs/features/frontend-stale-session-fallback/3-changelog.md` | 新建 | 本文 |
| `docs/features/INDEX.md` | +1 行 | 同笔加 |
| `改动日志.md` | +1 行索引 | 同笔加 |

## 验证

- `bun test packages/app/src/utils/stale-session-error.test.ts` → 10/10 pass
- `bun run typecheck` monorepo → 16/16 success(turbo cache 15 hit,本笔新加 1 cold)
- 完整 e2e:**user 装新 5.21.1-dev(含本 feat + sdk-falsy-empty-body-fix)→ 即使 ~/Library/Application Support/<bundle>/ 含 stale workspace state,启动应自动 navigate 去掉 stale id 显示主界面,不撞 ErrorBoundary**

## 后续 backlog

- **真根因(opencode 上游)**:sidecar 对未知 session id 应返 JSON `{"error":"session not found"}` + 404,而不是 401 + 空 body。这是 opencode-cli 行为问题,跨上游修。
- **403 / 410 / 451 等其他 4xx 是否视为 stale**:目前只识别 401/404。如果以后撞到 sidecar 用其他 status code 表达 stale,扩 regex。
- **Tauri 端启动 hook 主动 prune stale workspace state**:更早一步,直接读 `opencode.workspace.*.dat` 检查 session id 是否仍存在,不存在直接清掉。比当前 fallback 干净,但要 Tauri Rust 端读 LMDB/SQLite,工作量大,需求驱动再做。
- **Win 端**:本 feat 同样生效(`directory-layout.tsx` 是双端共享的 frontend),Win 用户首次启动 5.21.x ship 升级路径同样不会撞。
