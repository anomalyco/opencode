---
feat-id: imbot-workspace-rename
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# imbot-workspace-rename — 2-plan(实施计划)

## 规模:Medium ~80 行代码 + ~60 行测试 + ~50 行 docs 同步 / 5 文件触动

## 实施顺序

### Phase 1 — `migrateLegacyWorkspace` helper(~30 行)

`plugin.ts` 顶部新加 pure-ish helper(R5 helper extract 模式 + DI 友好测):

```ts
/**
 * 把老 ~/.opencode/feishu-workspace/ 迁移到新 ~/.opencode/imbot-workspace/(原子 rename)。
 *
 * 行为表(详 1-spec §测试用例):
 *   - legacy 存在 + new 不存在 → mv,返 "migrated"
 *   - legacy 不存在 + new 存在 → no-op
 *   - 两者都不存在 → no-op(初次安装)
 *   - 两者都存在 → warn,不动(罕见 — user 自己建过)
 *   - mv 抛错 → warn + 不崩
 *
 * [feat: imbot-workspace-rename] 2026-05-25
 */
export type MigrateResult =
  | "migrated"
  | "noop-already-new"
  | "noop-no-legacy"
  | "skipped-both-exist"
  | "failed"

export function migrateLegacyWorkspace(
  legacyPath: string,
  newPath: string,
  fs: { existsSync: (p: string) => boolean; renameSync: (o: string, n: string) => void },
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): MigrateResult {
  const legacyExists = fs.existsSync(legacyPath)
  const newExists = fs.existsSync(newPath)
  if (!legacyExists && newExists) return "noop-already-new"
  if (!legacyExists && !newExists) return "noop-no-legacy"
  if (legacyExists && newExists) {
    logger.warn(
      `[feishu-plugin] both legacy ${legacyPath} and new ${newPath} exist — keeping new, please check manually`,
    )
    return "skipped-both-exist"
  }
  // legacyExists && !newExists
  try {
    fs.renameSync(legacyPath, newPath)
    logger.info(`[feishu-plugin] migrated legacy workspace path ${legacyPath} → ${newPath}`)
    return "migrated"
  } catch (e) {
    logger.warn(
      `[feishu-plugin] failed to migrate legacy workspace ${legacyPath} → ${newPath}: ${(e as Error).message}. Please mv manually.`,
    )
    return "failed"
  }
}
```

### Phase 2 — 常量重命名 + 初始化整合(~30 行)

**plugin.ts**:

```ts
// 改前
const FEISHU_WORKSPACE = join(homedir(), ".opencode", "feishu-workspace")

// 改后
const LEGACY_WORKSPACE = join(homedir(), ".opencode", "feishu-workspace")
const IMBOT_WORKSPACE = join(homedir(), ".opencode", "imbot-workspace")
```

启动 init 流程加 migration 调用:

```ts
// plugin init(在 mkdirSync 之前)
migrateLegacyWorkspace(LEGACY_WORKSPACE, IMBOT_WORKSPACE, { existsSync, renameSync }, console)
mkdirSync(IMBOT_WORKSPACE, { recursive: true })
```

**message-pipeline.ts**:

```ts
// 改前
const FEISHU_WORKSPACE = join(homedir(), ".opencode", "feishu-workspace")

// 改后
const IMBOT_WORKSPACE = join(homedir(), ".opencode", "imbot-workspace")
```

全部 `FEISHU_WORKSPACE` 引用 sed 替换为 `IMBOT_WORKSPACE`(9 处)。

注释里 `~/.opencode/feishu-workspace/` 字面字符串也同步改 `~/.opencode/imbot-workspace/`。

**reply-actions.ts**:

```ts
// 改前
export const FEISHU_WORKSPACE_ROOT = join(homedir(), ".opencode", "feishu-workspace")

// 改后
export const IMBOT_WORKSPACE_ROOT = join(homedir(), ".opencode", "imbot-workspace")
```

`classifyAttachment` 默认参数 `workspaceRoot: string = IMBOT_WORKSPACE_ROOT`。

**core/opencode-client.ts**:注释里 `~/.opencode/feishu-workspace` → `~/.opencode/imbot-workspace`。

### Phase 3 — 测试(~60 行)

**新加** `__tests__/migrate-legacy-workspace.test.ts`(或加进 `plugin.test.ts` 如果存在,否则新建独立测试文件):

T1-T6 共 6 个 case,用 mock fs + mock logger(纯函数,不触摸真实文件系统)。

```ts
import { describe, expect, test, mock } from "bun:test"
import { migrateLegacyWorkspace } from "../plugin"

function makeFakeFs(opts: {
  legacyExists: boolean
  newExists: boolean
  renameError?: Error
}) {
  const renameSync = mock(() => {
    if (opts.renameError) throw opts.renameError
  })
  const existsSync = (p: string) =>
    p.endsWith("feishu-workspace") ? opts.legacyExists : opts.newExists
  return { existsSync, renameSync }
}

function makeFakeLogger() {
  const info: string[] = []
  const warn: string[] = []
  return {
    info: (m: string) => info.push(m),
    warn: (m: string) => warn.push(m),
    _info: info,
    _warn: warn,
  }
}

describe("migrateLegacyWorkspace", () => {
  test("T1: legacy exists, new doesn't → migrated", () => {
    const fs = makeFakeFs({ legacyExists: true, newExists: false })
    const log = makeFakeLogger()
    expect(migrateLegacyWorkspace("/L", "/N", fs, log)).toBe("migrated")
    expect(fs.renameSync).toHaveBeenCalledTimes(1)
    expect(fs.renameSync).toHaveBeenCalledWith("/L", "/N")
    expect(log._info.join("\n")).toContain("migrated legacy workspace")
  })

  test("T2: only new exists → noop-already-new", () => {
    const fs = makeFakeFs({ legacyExists: false, newExists: true })
    const log = makeFakeLogger()
    expect(migrateLegacyWorkspace("/L", "/N", fs, log)).toBe("noop-already-new")
    expect(fs.renameSync).toHaveBeenCalledTimes(0)
  })

  test("T3: neither exists → noop-no-legacy", () => {
    const fs = makeFakeFs({ legacyExists: false, newExists: false })
    const log = makeFakeLogger()
    expect(migrateLegacyWorkspace("/L", "/N", fs, log)).toBe("noop-no-legacy")
    expect(fs.renameSync).toHaveBeenCalledTimes(0)
  })

  test("T4: both exist → warn + skip", () => {
    const fs = makeFakeFs({ legacyExists: true, newExists: true })
    const log = makeFakeLogger()
    expect(migrateLegacyWorkspace("/L", "/N", fs, log)).toBe("skipped-both-exist")
    expect(fs.renameSync).toHaveBeenCalledTimes(0)
    expect(log._warn.join("\n")).toContain("both")
  })

  test("T5: rename throws → failed, warn, no crash", () => {
    const fs = makeFakeFs({
      legacyExists: true,
      newExists: false,
      renameError: new Error("EACCES"),
    })
    const log = makeFakeLogger()
    expect(() => {
      const r = migrateLegacyWorkspace("/L", "/N", fs, log)
      expect(r).toBe("failed")
    }).not.toThrow()
    expect(log._warn.join("\n")).toContain("failed to migrate")
    expect(log._warn.join("\n")).toContain("EACCES")
  })

  test("T6: actual filesystem rename moves subdirectory contents", () => {
    // 这个 case 用真实 fs(tmp dir) 验证 mv 行为(legacy 子内容 mv 后跟 new 一起)
    const { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync, renameSync } =
      require("node:fs")
    const { join } = require("node:path")
    const { tmpdir } = require("node:os")
    const tmp = mkdtempSync(join(tmpdir(), "migrate-test-"))
    const legacy = join(tmp, "feishu-workspace")
    const newP = join(tmp, "imbot-workspace")
    mkdirSync(join(legacy, ".opencode", "agent"), { recursive: true })
    writeFileSync(join(legacy, ".opencode", "agent", "imbot.md"), "test content", "utf-8")
    writeFileSync(join(legacy, "test.png"), "fake png", "utf-8")

    const log = makeFakeLogger()
    const r = migrateLegacyWorkspace(legacy, newP, { existsSync, renameSync }, log)
    expect(r).toBe("migrated")
    expect(existsSync(legacy)).toBe(false)
    expect(existsSync(newP)).toBe(true)
    expect(readFileSync(join(newP, ".opencode", "agent", "imbot.md"), "utf-8")).toBe("test content")
    expect(readFileSync(join(newP, "test.png"), "utf-8")).toBe("fake png")

    rmSync(tmp, { recursive: true, force: true })
  })
})
```

**常量值测试**(扩 `reply-actions.test.ts`):

```ts
test("T7: IMBOT_WORKSPACE_ROOT 值正确", () => {
  expect(IMBOT_WORKSPACE_ROOT).toBe(join(homedir(), ".opencode", "imbot-workspace"))
})
```

T8 类似补 `IMBOT_WORKSPACE`(message-pipeline.test.ts 或新加独立 plugin.test.ts)。

**既有测试更新**:`message-pipeline.test.ts:974` 的 tmp dir 名 `"feishu-workspace"` 改成 `"imbot-workspace"`(测试 fixture 命名,跟生产代码常量一致)。`reply-actions.test.ts:9` 的 import `FEISHU_WORKSPACE_ROOT` 改 `IMBOT_WORKSPACE_ROOT` + line 190/191/193 字面字符串改。

### Phase 4 — Active 文档同步

**改**:
- `docs/governance/imbot-定制指南.md`:全文 `~/.opencode/feishu-workspace` → `~/.opencode/imbot-workspace`
- `CLAUDE.md`:grep 没看到引用,可能不用改;再 verify
- `OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md`:同 imbot 指南,全文替换
- `OPENCODE-PLAN` 仓 INDEX.md:不引用具体路径

**不改**(历史快照保留):
- `docs/features/*/3-changelog.md` 所有历史 changelog(快照,不改)
- `docs/features/*/1-spec.md` 已 done feat 的(快照)
- `docs/features/im-account-agent-workspace-binding/1-spec.md`(已 superseded,保留)
- 改动日志.md 历史 entries(快照)

**memory 同步**:
grep `~/.opencode/feishu-workspace\|feishu-workspace` 在 `~/.claude/projects/-Volumes-ExtSSD-opencode-fork/memory/*.md`,凡是引用这条路径的 active memory 都更新。

### Phase 5 — 实施后必跑测试(对照 1-spec C1-C10)

详 1-spec `## 实施后必跑测试清单`。

## commit 链(预期)

| # | commit message |
|---|---|
| 1 | `docs(imbot-workspace-rename): 1-spec + 2-plan + INDEX entry [feat: imbot-workspace-rename]` |
| 2 | `feat(imbot-workspace-rename): rename feishu-workspace → imbot-workspace + migration helper + 测试 [feat: imbot-workspace-rename]` |
| 3 | `docs(imbot-workspace-rename): 同步 imbot-定制指南 + OPENCODE-PLAN ADR + 改动日志 [feat: imbot-workspace-rename]` |
| 4(可能)| `chore(imbot-workspace-rename): 同步 memory entries [feat: imbot-workspace-rename]` — memory 不在 git 但也要同步 |

## 风险 / 注意点

| 风险 | 缓解 |
|---|---|
| user 已经在老 feishu-workspace 里放了重要文件(项目级 imbot.md / 实际工作产物) | migration 自动 mv 整个目录,保留所有内容 |
| migration 失败 user 看不到日志 | warn 写到 console + DeskFox 日志,user 启动后 ~/Library/Logs/ai.deskfox.app/ 可看;且 plugin 不崩(降级到默认 mkdir 新路径) |
| renameSync 跨文件系统失败 | T5 case 兜底 warn,不阻断 plugin 启动 |
| 老 path 引用在 user 已发的飞书消息历史里 | 不影响,文件路径只是 user 看的字符串,不影响功能 |
| ADR 改完老链接断 | 本仓改 imbot-定制指南 同步;ADR 在 OPENCODE-PLAN 仓也同步 |
| 用户回退到旧版本 DeskFox 后发现新路径 imbot-workspace 旧版认不出 | 旧版仍尝试用 feishu-workspace path,**会重新创建空目录**;但 user 已 mv 走了文件 → 等于 user 用旧版看不到自己的文件。建议本 ship 走 Tier 2 dev 先验,稳定后 prod;**回退 mitigation 文档化**(release note 注明) |

## 实施中决策点(开发中 append)

(空 — 开发中遇到再补)
