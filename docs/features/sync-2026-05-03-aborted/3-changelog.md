---
feat-id: sync-2026-05-03-aborted
status: done
related: ./3-changelog.md
---

# sync-2026-05-03-aborted — changelog

## 背景

2026-05-03 user 决定"开始 sync upstream merge"任务。当时 dev 有完整 prep:
- ① zod-schema-bridge 已落 `b8636882c`(office-pdf-ref 抽离 vendor MIME,Content schema 上 fork 字段值依赖归零)
- ② updater-disable-adapter 试做后 rollback `1c714bae5`(sentinel pattern 撞 UX bug,撤回 + 沉淀教训)

dev 干净,upstream/dev 比 dev 多 **440 commits / 1157 文件 / +58k/-53k 行**。

## 操作过程

### Pre-merge(成功)

```bash
git switch sync/upstream-2026-05-03  # 已开,在 1c714bae5
git merge --ff-only dev              # FF 到 dev 最新
git tag pre-merge-2026-05-03         # baseline 兜底
git fetch upstream                   # upstream/dev 到 c4311dda3
```

### Merge 启动 — 8 个 conflict

```bash
git merge --no-commit --no-ff upstream/dev
```

输出:

| # | 文件 | playbook 类型 | 解法 |
|---|---|---|---|
| 1 | `bun.lock` | 类型 1 机械 | regen ⚠️ — **此处第一次踩坑,见 §blocker B** |
| 2 | `packages/app/package.json` | 类型 2 双 dep 加 | 保留两个(`@opencode-ai/branding` + `@sentry/solid`) |
| 3 | `packages/app/src/components/session/session-new-view.tsx` | 类型 3+4 混合 | 保 fork branding `Mark` import + 跟 upstream `shared → core` rename `getDirectory` |
| 4 | `packages/core/src/office-pdf-protocol.ts` | 类型 (file location) | git 自动跟 `shared/` → `core/` rename,内容不变,`git add` 确认 |
| 5 | `packages/desktop/src/index.tsx` | 类型 4 策略路线分歧 | **混合**:保 fork conditional spread 结构(playbook 已记录)+ 跟上游 `update → updateAndRestart` rename + 加 `relaunch()` |
| 6 | `packages/opencode/src/file/index.ts` | 类型 5 同 schema 双改 | **zod-schema-bridge prep 起作用!** 直接 take 上游 Schema.Struct 重写,无 fork 字段值要保留;import path 跟 `shared → core` rename |
| 7-8 | `packages/sdk/js/src/v2/gen/{sdk,types}.gen.ts` | 类型?(auto-gen) | 第一次 take upstream(--theirs)→ 失去 fork office routes → typecheck 错 → 再 take HEAD(--ours)→ 失去 upstream 新 type → typecheck 还错 → **blocker A,见下** |

外加 auto-merge 成功(无 conflict)的 ~10 个文件,主要是 `packages/app/src/i18n/*.ts`、`packages/desktop-electron/*`、fork 的 `session/llm.ts`、`session/prompt.ts`、`server/routes/instance/file.ts` 等。

### 上游意外 — `shared` → `core` 整包改名(PR #24309)

`62ef2a220 refactor: rename shared package to core (#24309)` 把 `packages/shared/` 整包改名为 `packages/core/`。影响:

| Fork 文件 | 老 import | 改成 |
|---|---|---|
| `packages/app/src/components/session/session-new-view.tsx` | `@opencode-ai/shared/util/path` | `@opencode-ai/core/util/path` |
| `packages/opencode/src/file/index.ts` | `@opencode-ai/shared/filesystem` + `@opencode-ai/shared/office-pdf-protocol` | `@opencode-ai/core/filesystem` + `@opencode-ai/core/office-pdf-protocol` |
| `packages/ui/src/pierre/media.ts` | `@opencode-ai/shared/office-pdf-protocol` | `@opencode-ai/core/office-pdf-protocol` |
| `packages/opencode/src/file/libreoffice.ts` | `../global` + `../util`(老路径,Global/Log 上游已迁 core)| `@opencode-ai/core/global` + `@opencode-ai/core/util/log` + `@/util/process`(Process 仍在 opencode) |
| `packages/opencode/src/file/office-installer.ts` | 同上 | 同上 |
| `.husky/pre-commit` BLACKLIST_REGEX | `(...|shared|...)` | 加 `core` → `(...|core|...|shared|...)` |

scope 可控,~7 个 fork-only 改动 + 1 个 hook regex 更新,**机械化**。

## Blocker A — SDK 双路径互斥(致命)

### 现象

upstream PR(若干笔)把 opencode CLI 重构到 **Effect HttpApi**,引入 `packages/opencode/src/server/routes/instance/httpapi/` 整套 infrastructure:`api.ts` / `public.ts` / `groups/*.ts` / `handlers/*.ts`。SDK build 默认 `OPENCODE_SDK_OPENAPI=httpapi` 走这个 PublicApi 出 SDK。

opencode CLI src 大量 import 这些 httpapi-only 的 type,如 `SessionMessage` / `SessionMessageAssistant` / `SessionMessageAssistantReasoning` / `SessionMessageAssistantText` / `SessionMessageAssistantTool` 等。

但 fork 加的 4 个 office routes 在 **Hono routes**(`packages/opencode/src/server/routes/instance/file.ts:194-269`),不在 PublicApi 里:
- `file.officePdf` (`/file/office-pdf`)
- `office.tooling.status` (`/office-tooling/status`)
- `office.tooling.install` (`/office-tooling/install`)
- `office.tooling.progress` (`/office-tooling/progress`)

`packages/app/src/pages/session/file-tabs.tsx` 调这 4 个 method:`sdk.client.file.officePdf()` / `sdk.client.office.tooling.{status,install,progress}()`。

### 矩阵

| SDK gen 模式 | 命令 | opencode CLI typecheck | fork file-tabs typecheck |
|---|---|---|---|
| `httpapi`(默认) | `bun run --cwd packages/sdk/js build` | ✅ | ❌ 缺 office routes |
| `hono` | `OPENCODE_SDK_OPENAPI=hono bun run --cwd packages/sdk/js build` | ❌ 缺 SessionMessage* 等新 type | ✅ |

### 路径选择(已决策)

走 **Reframe 3 — 纯文档 prep,merge 时再写代码**(详 [`docs/features/office-routes-effect-httpapi/1-spec.md`](../office-routes-effect-httpapi/1-spec.md)):
- 把 fork 的 4 个 office routes 迁到 PublicApi(`HttpApiEndpoint`),加进 `httpapi/groups/file.ts` 的 FORK block
- handler 加进 `httpapi/handlers/file.ts` 的 FORK block,调现有 fork 的 `LibreOffice` / `OfficeInstaller` 业务逻辑
- 用一个 fork-only 文件 `httpapi/groups/file-office.ts` 集中 schema 定义
- 这工作**不能在 dev 上独立做**(PublicApi infra 在 dev 上不存在),**作为下次 sync merge 的一部分**落地

考虑过的备选:
- A1(预 migrate dev)— PublicApi infra 不存在,**做不到**
- A2(预写 fork-only schema 文件,带 unresolved import)— 增加 typecheck exclude / ts-ignore 复杂度,**不推荐**
- B(file-tabs.tsx 改 raw fetch 绕开 SDK)— 增加 file-tabs 复杂度,SDK 类型安全丢失,**短期可行但长期治标不治本**
- C(继续推,manually patch 4 个 office method 到 httpapi SDK gen)— auto-gen 文件被手编辑下次 regen 必被 clobber,**不可持续**
- D(此次 abort,等上游 office routes 路径成熟)— 短期最稳但下次 sync 仍撞同样坑

按"稳定 + 跟上上游 + 永久解决"三原则,**A 路径(改 office routes 进 PublicApi)是唯一同时满足三条的解法,选定为下次 sync 的 prep**。

## Blocker B — `bun.lock` 处理踩坑

### 现象

merge 报 `CONFLICT (content): Merge conflict in bun.lock`。第一反应"删 lock 重 install"(常见做法):

```bash
rm bun.lock && bun install
```

`bun install` 完成后 SDK regen `bun run --cwd packages/sdk/js build` 报:

```
SyntaxError: Export named 'generateCodeChallenge' not found in module
'D:\project\opencode-fork\node_modules\.bun\mcp-oauth@1.0.0\node_modules\mcp-oauth\dist\index.js'
```

### Root cause

`packages/opencode/package.json` dep `opencode-poe-auth: 0.0.1`。`opencode-poe-auth` 自己 dep 上 `poe-oauth: *`(任意版本)。`*` 让 bun 自由 resolve 到最新。

| 状态 | poe-oauth resolve | poe-oauth deps |
|---|---|---|
| 上游 lock(健康)| `0.0.6` | (空 — 无 mcp-oauth dep)|
| 删 lock 后 fresh install | `0.0.7`(latest) | `mcp-oauth: *` → 拉到 `mcp-oauth@1.0.0` |

`mcp-oauth@1.0.0` 实际 export `InMemoryEventStore / ServerType / proxyServer / startHTTPStreamServer / startSSEServer / startStdioServer / tapTransport`,**没有** `generateCodeChallenge`。但 transitive 某 dep 引用了 `generateCodeChallenge` → bun 模块加载错 → 阻断 SDK regen。

### 解法(已沉淀到 UPSTREAM-MERGE-GUIDE §4.7)

```bash
git show upstream/dev:bun.lock > bun.lock  # take 上游 lock
bun install --force --ignore-scripts        # 增量 reconcile,忽略 native postinstall
```

成功 — `poe-oauth@0.0.6` 装上,`mcp-oauth` 不被 pull,SDK regen 通过。

### 教训(UPSTREAM-MERGE-GUIDE §7 已加)

- **bun.lock 别删!** 解 lock 冲突走 `git checkout --theirs/--ours bun.lock && bun install`,详 §4.7
- **deps `*` version 自由 resolve 风险** — fork 自己的 deps 应避免 `*`,但上游 deps 用了 `*` 也会传染过来。`bun.lock` 锁定就是防这个

## 完整 git artifacts(供下次 sync 参考)

| Tag | 内容 |
|---|---|
| `pre-merge-2026-05-03` | merge 前 baseline,= `1c714bae5`(本次起点) |
| `_backup-mid-merge-sync-2026-05-03` | mid-merge stash 完整内容 — 8 个 conflict 全 resolve + SDK gen 适配尝试。**下次 sync 时可以参考这个 stash 看每个 conflict 怎么解的** |
| 其他历史 sync tag(`_backup-pre-merge-sync-2026-05-02` / `archive-sync-2026-04-30` 等)| 之前几次 sync 尝试的快照 |

恢复 stash 内容查看(只读,不要 apply 到当前分支):

```bash
git checkout _backup-mid-merge-sync-2026-05-03 -- <some-file>  # 单文件取出查看
git diff dev _backup-mid-merge-sync-2026-05-03 -- <some-file>  # 对比差异
```

## Sync 分支处置

`sync/upstream-2026-05-03` 在 abort 后 == dev(`1c714bae5`),**没动内容**,可保留可删:
- 保留:无害,占用 1 个 branch 名
- 删:下次 sync 用 `sync/upstream-<新日期>` 新名,符合 v2 分支策略"sync 临时分支,merge 完即删"

**建议**:此次 sync 实际上没做出 merge commit → branch 内容 = dev,保留无意义,**删了下次重开新名**。

## 净落地内容

本笔 commit **不落任何代码改动**,仅:
- `docs/features/office-routes-effect-httpapi/1-spec.md`(新)— 下次 sync 期间 office routes 迁 Effect HttpApi 的详细 spec
- `docs/features/sync-2026-05-03-aborted/3-changelog.md`(本文档)— 本次 sync 完整复盘 + 教训
- `docs/governance/UPSTREAM-MERGE-GUIDE.md`:
  - 加 §4.7 "bun.lock 处理方法学" — 不删 lock,take 任一边再 install
  - §4.6 第 3 步加引用 §4.7
  - §7 加 2 行踩坑(bun.lock 自由 resolve / SDK 双路径互斥)
  - TL;DR 加 2 条(bun.lock 别删 / Hono routes 是技术债)
- `docs/features/INDEX.md` + `本仓 改动日志.md`:索引

代码 0 改,纯 governance + spec 沉淀。

## R4 override

无。

## 下次 sync 入手 checklist

参考 spec + 本 changelog,新 sync 分支起手:

```bash
git switch -c sync/upstream-<新日期> dev
git tag pre-merge-<新日期>
git fetch upstream
git merge --no-commit --no-ff upstream/dev

# 处理 conflicts:
# - bun.lock: 走 §4.7 take theirs + install
# - 其他: 按 §4.4 类型表 + 本 changelog "操作过程" 表对号入座
# - **必做新增**:office routes 迁 Effect HttpApi(参 features/office-routes-effect-httpapi/1-spec.md)

# verify:
bun turbo typecheck --force
bun run --cwd packages/sdk/js build           # httpapi 模式默认
grep "officePdf\|officeToolingStatus" packages/sdk/js/src/v2/gen/sdk.gen.ts  # 应有
.\packages\branding\scripts\build-deskfox.ps1 -Env dev -NoBundle
```

预期 ~5-7 小时完成下次 sync(含 office routes 迁移 4-6 小时 + 其他 conflict 解决 1-2 小时,前提是上游不再叠新意外)。
