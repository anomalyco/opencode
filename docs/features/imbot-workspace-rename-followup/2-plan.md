---
feat-id: imbot-workspace-rename-followup
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# imbot-workspace-rename-followup — 2-plan(实施计划)

## 规模:Medium- ~50 行代码 + ~70 行测试 / 2 文件 / 0 上游侵入

## 实施顺序

### Phase 1 — helper `applyStaleSessionsCleanup`(~40 行)

`plugin.ts` 在 `migrateLegacyWorkspace` helper 后追加:

```ts
/**
 * imbot-workspace-rename 落地后,chatSessionStore 里 session ID 还绑老 directory
 * (~/.opencode/feishu-workspace)→ LLM 用老 system prompt + 老 cwd → emit ATTACH
 * marker 用老路径 → ENOENT 报错。
 *
 * 修法:user 升级到本 feat 版本后首次启动,清掉 chatSessionStore 让 plugin 重建
 * session 用新 directory。marker 文件保证 idempotent(只清一次)。
 *
 * Trade:user 失去所有 chat 的 multi-turn memory(one-time cost)。比 stale path
 * 长期错乱好。
 *
 * [feat: imbot-workspace-rename-followup] 2026-05-25
 */
export type CleanupResult =
  | "applied"               // 清了 + 写了 marker
  | "noop-already-applied"  // marker 已存在
  | "noop-no-sessions"      // chatStore 不存在,只写 marker
  | "failed"                // 错误

export function applyStaleSessionsCleanup(
  markerPath: string,
  chatSessionStorePath: string,
  fs: {
    existsSync: (p: string) => boolean
    unlinkSync: (p: string) => void
    writeFileSync: (p: string, data: string) => void
  },
  logger: { info: (m: string) => void; warn: (m: string) => void },
): CleanupResult {
  if (fs.existsSync(markerPath)) {
    return "noop-already-applied"
  }
  const markerContent = JSON.stringify(
    { appliedAt: new Date().toISOString(), feat: "imbot-workspace-rename" },
    null,
    2,
  )
  if (!fs.existsSync(chatSessionStorePath)) {
    try {
      fs.writeFileSync(markerPath, markerContent)
      return "noop-no-sessions"
    } catch (e) {
      logger.warn(
        `[feishu-plugin] failed to write cleanup marker ${markerPath}: ${(e as Error).message}`,
      )
      return "failed"
    }
  }
  // marker 不存在 + chatStore 存在 → 清 + 写 marker
  try {
    fs.unlinkSync(chatSessionStorePath)
  } catch (e) {
    logger.warn(
      `[feishu-plugin] failed to clear stale chat sessions ${chatSessionStorePath}: ${(e as Error).message}. Please rm manually + restart.`,
    )
    return "failed"
  }
  try {
    fs.writeFileSync(markerPath, markerContent)
  } catch (e) {
    logger.warn(
      `[feishu-plugin] cleared chat sessions but failed to write cleanup marker ${markerPath}: ${(e as Error).message}. Next start will clean again.`,
    )
    return "failed"
  }
  logger.info(
    `[feishu-plugin] cleared stale chat sessions after workspace rename (${chatSessionStorePath} removed, marker written)`,
  )
  return "applied"
}
```

### Phase 2 — `initBackground` 接入(~10 行)

`plugin.ts` 加常量 + initBackground 调用:

```ts
// 顶部常量
const STALE_SESSIONS_CLEANUP_MARKER = join(
  homedir(),
  ".opencode",
  ".imbot-workspace-rename-cleanup-applied",
)
const CHAT_SESSION_STORE_PATH = join(
  homedir(),
  ".opencode",
  "feishu-chat-sessions.json",
)

// initBackground 内,migrateLegacyWorkspace 之后,mkdirSync 之前
async function initBackground(): Promise<void> {
  // 0a. 老路径 feishu-workspace 自动迁移到 imbot-workspace
  migrateLegacyWorkspace(LEGACY_WORKSPACE, IMBOT_WORKSPACE, ...)

  // 0a.5 清 stale chat sessions(imbot-workspace-rename-followup,marker 幂等)
  applyStaleSessionsCleanup(
    STALE_SESSIONS_CLEANUP_MARKER,
    CHAT_SESSION_STORE_PATH,
    { existsSync, unlinkSync, writeFileSync },
    { info: (m) => console.log(m), warn: (m) => console.warn(m) },
  )

  // 0b. 确保 IM 桥接共享 workspace 目录存在
  try { mkdirSync(IMBOT_WORKSPACE, { recursive: true }) } catch (err) { ... }
  ...
}
```

需补 import:`unlinkSync`(其他 `existsSync` / `writeFileSync` / `renameSync` 已 import)。

### Phase 3 — 测试(~70 行)

**新建** `packages/adapter-feishu-lark/src/__tests__/apply-stale-sessions-cleanup.test.ts`:

```ts
import { describe, expect, mock, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyStaleSessionsCleanup } from "../plugin"

function makeFakeFs(opts: {
  markerExists: boolean
  storeExists: boolean
  unlinkError?: Error
  writeFileError?: Error
}) {
  const unlinkSync = mock<(p: string) => void>(() => {
    if (opts.unlinkError) throw opts.unlinkError
  })
  const writeFileSync = mock<(p: string, d: string) => void>(() => {
    if (opts.writeFileError) throw opts.writeFileError
  })
  return {
    existsSync: (p: string): boolean => {
      if (p.endsWith("cleanup-applied")) return opts.markerExists
      if (p.endsWith("chat-sessions.json")) return opts.storeExists
      return false
    },
    unlinkSync,
    writeFileSync,
  }
}
function makeFakeLogger() {
  const info: string[] = []
  const warn: string[] = []
  return { info: (m: string) => info.push(m), warn: (m: string) => warn.push(m), _info: info, _warn: warn }
}

describe("applyStaleSessionsCleanup", () => {
  test("T1: marker 已存在 → noop-already-applied", () => {
    const fs = makeFakeFs({ markerExists: true, storeExists: true })
    const log = makeFakeLogger()
    expect(applyStaleSessionsCleanup("/M", "/S", fs, log)).toBe("noop-already-applied")
    expect(fs.unlinkSync).toHaveBeenCalledTimes(0)
    expect(fs.writeFileSync).toHaveBeenCalledTimes(0)
  })

  test("T2: marker 不存在 + chatStore 不存在 → noop-no-sessions + 写 marker", () => {
    const fs = makeFakeFs({ markerExists: false, storeExists: false })
    const log = makeFakeLogger()
    expect(applyStaleSessionsCleanup("/M", "/S", fs, log)).toBe("noop-no-sessions")
    expect(fs.unlinkSync).toHaveBeenCalledTimes(0)
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
  })

  test("T3: marker 不存在 + chatStore 存在 → applied + 清 + 写 marker", () => {
    const fs = makeFakeFs({ markerExists: false, storeExists: true })
    const log = makeFakeLogger()
    expect(applyStaleSessionsCleanup("/M", "/S", fs, log)).toBe("applied")
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1)
    expect(fs.unlinkSync).toHaveBeenCalledWith("/S")
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
    expect(log._info.join("\n")).toContain("cleared stale chat sessions")
  })

  test("T4: unlink chatStore 抛 EACCES → failed + warn + 不写 marker", () => {
    const fs = makeFakeFs({
      markerExists: false,
      storeExists: true,
      unlinkError: new Error("EACCES"),
    })
    const log = makeFakeLogger()
    expect(applyStaleSessionsCleanup("/M", "/S", fs, log)).toBe("failed")
    expect(fs.writeFileSync).toHaveBeenCalledTimes(0)
    expect(log._warn.join("\n")).toContain("EACCES")
    expect(log._warn.join("\n")).toContain("failed to clear stale chat sessions")
  })

  test("T5: chatStore 不存在 + 写 marker 抛错 → failed + warn", () => {
    const fs = makeFakeFs({
      markerExists: false,
      storeExists: false,
      writeFileError: new Error("ENOSPC"),
    })
    const log = makeFakeLogger()
    expect(applyStaleSessionsCleanup("/M", "/S", fs, log)).toBe("failed")
    expect(log._warn.join("\n")).toContain("ENOSPC")
    expect(log._warn.join("\n")).toContain("failed to write cleanup marker")
  })

  test("T6: 真实 fs:chatStore 存在 → applied,文件被删 + marker 创建含 valid JSON", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cleanup-test-"))
    const marker = join(tmp, ".imbot-workspace-rename-cleanup-applied")
    const store = join(tmp, "feishu-chat-sessions.json")
    writeFileSync(store, JSON.stringify({ sessions: { acc1: { chat1: "ses_old" } } }), "utf-8")

    const log = makeFakeLogger()
    const r = applyStaleSessionsCleanup(
      marker,
      store,
      { existsSync, unlinkSync: require("node:fs").unlinkSync, writeFileSync },
      log,
    )
    expect(r).toBe("applied")
    expect(existsSync(store)).toBe(false)
    expect(existsSync(marker)).toBe(true)
    const markerContent = JSON.parse(readFileSync(marker, "utf-8"))
    expect(markerContent.feat).toBe("imbot-workspace-rename")
    expect(typeof markerContent.appliedAt).toBe("string")

    rmSync(tmp, { recursive: true, force: true })
  })
})
```

### Phase 4 — 收尾

- `bun run typecheck` 16/16
- `bun test packages/adapter-feishu-lark/`:目标 ~517+(原 511 + 新 6)
- 实测 C5-C8(见 1-spec)
- 3-changelog + INDEX status spec → done + 改动日志 entry

## commit 链(预期)

| # | commit |
|---|---|
| 1 | `docs(imbot-workspace-rename-followup): 1-spec + 2-plan + INDEX entry` |
| 2 | `feat(imbot-workspace-rename-followup): applyStaleSessionsCleanup helper + initBackground 接入 + 6 测试` |
| 3 | `docs(imbot-workspace-rename-followup): 3-changelog + INDEX done + 改动日志` |

## 风险 / 注意点

| 风险 | 缓解 |
|---|---|
| user 失去 multi-turn memory | 1-spec 接受,trade off well-documented |
| 已 /new 过的好 session 被一并清 | 接受(无差别清简单) |
| marker 文件被 user 误删 → 下次启动重新清 | 罕见,清完是空 chatStore 无影响(已经清过的状态) |
| chatSessionStore 持久化文件名是 `feishu-chat-sessions.json` 不是 `imbot-...` | 本 feat **不改**这个文件名(它确实是 feishu plugin specific,跟 home base 是不同概念,1-spec 已论证保留) |
| 清完后 user 第一条消息建新 session 可能 race | session.create 是同步阻塞,无 race |

## 实施中决策点

(空,开发中遇到再补)
