---
feat-id: sync-2026-05-03-2
status: done
related: ./3-changelog.md
---

# sync-2026-05-03-2 — changelog

## 触发

2026-05-03 早些时候 sync upstream merge 第一次尝试 abort(详 [`sync-2026-05-03-aborted/3-changelog.md`](../sync-2026-05-03-aborted/3-changelog.md))。后续完成两份 prep:
- [`win-bun-install-fix`](../win-bun-install-fix/) — 修 Windows install 阻断,sync workflow 解锁
- [`office-routes-effect-httpapi`](../office-routes-effect-httpapi/) spec — 下次 sync 期间 office routes 迁 Effect HttpApi 的详细模板

prep 完成后,本次重启 sync,**带上 spec + playbook 当 cheat sheet 一次推完**。

## 上游 scope

- `git fetch upstream`:upstream/dev 到 `c4311dda3` → 又涨到 `<新 hash>`(本次 fetch 时点)
- 本次 merge:**462 commits**(早上是 440,涨了 22 — typical 上游迭代速度)
- 文件:1157 → ~同量级
- conflict:8 个(跟早上完全一致 — 上游近期没改 fork-touched 文件)

## 操作过程

### Setup(Task 1)

```bash
git switch -c sync/upstream-2026-05-03-2 dev
git tag pre-merge-2026-05-03-2
git fetch upstream
```

### Conflict resolution(Task 2-4,~30 分钟)

按 [`UPSTREAM-MERGE-GUIDE.md`](../../governance/UPSTREAM-MERGE-GUIDE.md) §4.6 顺序 + 早上 sync 的 cheat sheet,机械执行:

| 文件 | 解法 |
|---|---|
| `bun.lock` | **走新 §4.7**: `git checkout --theirs bun.lock` + `bun install`(保上游版本不被自由 resolve 升级,**早上踩的 mcp-oauth 坑这次绕过去**)|
| `packages/app/package.json` | 类型 2:keep both `@opencode-ai/branding` + `@sentry/solid` |
| `packages/app/src/components/session/session-new-view.tsx` | 类型 4:保 fork branding `Mark` + 类型 3:跟 shared→core rename |
| `packages/core/src/office-pdf-protocol.ts` | git 自动跟 shared→core rename;`git add` 确认 |
| `packages/desktop/src/index.tsx` | 类型 4:保 fork conditional spread + 跟上游 `update→updateAndRestart` rename + 加 `relaunch()` |
| `packages/opencode/src/file/index.ts` | **类型 5,zod-schema-bridge 起作用** — Content schema 直接 take 上游(无 fork 字段值要保留);跟 shared→core rename |
| `packages/sdk/js/src/v2/gen/{sdk,types}.gen.ts` | take theirs(待会儿 regen) |

附带改动(Task 4):
- `packages/opencode/src/file/{libreoffice,office-installer}.ts`:`../global` `../util` → `@opencode-ai/core/global` + `@opencode-ai/core/util/log` + `@/util/process`(Process 仍 opencode 内部)
- `packages/ui/src/pierre/media.ts`:`@opencode-ai/shared/office-pdf-protocol` → `@opencode-ai/core/office-pdf-protocol`
- `.husky/pre-commit` `BLACKLIST_REGEX`:加 `core`(blacklist 适配 shared→core rename)

### Office routes 迁 Effect HttpApi(Task 5,~1 小时)

按 [`office-routes-effect-httpapi/1-spec.md`](../office-routes-effect-httpapi/1-spec.md) 模板:

1. **新建 fork-only schema 文件** `packages/opencode/src/server/routes/instance/httpapi/groups/file-office.ts`(40 行):
   - `OfficePdfQuery` / `OfficePdfBytes`(用 `HttpApiSchema.asUint8Array({contentType: "application/pdf"})` 标 binary)
   - `OfficeInstallProgress` / `OfficeToolingStatus`

2. **改 `groups/file.ts` 加 FORK block**(20 行新增):
   - `FilePaths` 加 4 path 常量
   - `FileApi` 加 4 个 `HttpApiEndpoint` 在 FORK-BEGIN/END 块内

3. **改 `handlers/file.ts` 加 FORK block**(30 行新增):
   - 4 个 `Effect.fn` handler 调 `LibreOffice.convertToPdf` / `OfficeInstaller.{status, startInstall, getProgress}`
   - 注册到 `handlers.handle("officePdf", ...)` 等

**spec 待 dig 项 — binary response API 解决**:`HttpApiSchema.asUint8Array({contentType: "application/pdf"})` 是 idiomatic Effect HttpApi binary response pattern(d.ts 描述 `Marks a schema as a binary payload / response. The schema encoded side must be a Uint8Array.`)。

### Verify(Task 6)

```bash
bun run --cwd packages/sdk/js build  # SDK regen,默认 httpapi mode
grep "officePdf\|officeToolingStatus" packages/sdk/js/src/v2/gen/sdk.gen.ts
# ✅ 4 个 method 全在 SDK
```

第一次 typecheck 撞:
- `src/session/llm.ts(373,18): Cannot find name 'Instance'` — fork 之前用 `Instance.directory` / `Instance.project.id`(老 API),上游已迁到 `(yield* InstanceState.context).directory` 等

修复:在 streamText 调用前 pre-fetch `_instanceCtx = yield* InstanceState.context`,改 _opencode block 用 `_instanceCtx.directory` / `.project.id`。

二次 typecheck:**15/15 successful** ✅

Build:`build-deskfox.ps1 -Env dev -NoBundle` → DeskFox.exe ready(75s)✅

## blocker / 意外 / 没踩到的坑

### 没踩到(prep 起作用)
- ❌ **`bun.lock` 自由 resolve 坑**(早上撞)— 这次走 §4.7 take theirs,完全绕过
- ❌ **SDK 双路径互斥 blocker**(早上致命)— office-routes-effect-httpapi 落地后,httpapi 默认模式 SDK 已包含 fork office routes
- ❌ **`tree-sitter-powershell` install 阻断**(早上扯install 状态)— win-bun-install-fix 已修

### 唯一新坑
- `session/llm.ts` 用 `Instance.directory` 直接 global 访问,上游迁了 InstanceState Effect-based API → 1 处现场适配,5 分钟解决

### 共存设计(non-blocking)
- 老 Hono `/file/office-pdf` `/office-tooling/*` routes 仍在 `packages/opencode/src/server/routes/instance/file.ts:194-269` 没删 — 跟上游 `/find` `/file/content` 等 Hono+HttpApi 共存模式一致,不冲突。删除留 follow-up commit(可下次方便时做)

## 改动统计

- 854 文件 staged 进 merge commit
  - 大头是上游 462 commit 的累积:packages/app/* 大量 i18n / UI 更新,packages/opencode/* HttpApi 整套 infra(`httpapi/groups/` `httpapi/handlers/` `httpapi/middleware/` 等),`packages/core/*`(原 shared 改名)
  - fork 现场调整:~9 个文件(conflict resolution + import path adapt + office routes migration)
- fork 净新增 lines:~90 行(40 file-office.ts + 20 groups/file.ts FORK block + 30 handlers/file.ts FORK block)
- fork 删除 lines:~5 行(file/index.ts 删 fork 的 `import OFFICE_PDF_REF_MIME from shared/...`,改成 `core/...`)

## tag artifacts

| Tag | 内容 |
|---|---|
| `pre-merge-2026-05-03-2` | merge 前 baseline,= `b2f9dbfa1`(本次起点,环境修完的 dev 状态)|
| `_backup-mid-merge-sync-2026-05-03` | 早上 sync attempt 的 mid-merge stash(8 个 conflict 全 resolve,但当时 SDK blocker 没解)— 跟本次 commit 比对可见 office-routes-effect-httpapi 是关键解锁 |

## 验证

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --force`(全 monorepo,无缓存) | **15/15 successful** ✅ |
| `bun run --cwd packages/sdk/js build`(httpapi default mode) | 通过,SDK 含 fork office routes ✅ |
| `build-deskfox.ps1 -Env dev -NoBundle` 端到端 release build | **DeskFox.exe ready**(75s)✅ |
| Office viewer 打开 .docx/.pptx → PDF | 待 user 自验(走新 HttpApi PublicApi 路径,跟老 Hono 共存)|
| LibreOffice 安装入口 | 待 user 自验 |
| pre-push hook 真过 | env-fix 已修,期待 cache hit |

## 影响范围 + 健康指标

按上次 sync 的健康指标更新(2026-04-26 快照:上游侵入率 ~3% / 漂移 3 / override 1 笔):

- **上游侵入率**:本次 +~9 个 fork-touched 文件(file-office.ts 是新 fork-only 文件,剩 ~5 个是 import path 适配 + ~3 个是 fork-marker block 内改),+1 fork-only file。仍远低于 5% 目标
- **漂移 commit 数**:`git log dev..upstream/dev --oneline` 应回到 0(本次 merge 全 take 进来)
- **override 累计本季**:仍 3 笔(post-sync-build-fix + zod-schema-bridge + win-bun-install-fix),本次 sync 0 R4

## R4 override

无。

## 关联

- 早上 sync abort:[`sync-2026-05-03-aborted/3-changelog.md`](../sync-2026-05-03-aborted/3-changelog.md) — 提供 cheat sheet
- 中间 prep:[`win-bun-install-fix/3-changelog.md`](../win-bun-install-fix/3-changelog.md) + [`office-routes-effect-httpapi/1-spec.md`](../office-routes-effect-httpapi/1-spec.md)
- playbook 沉淀:[`UPSTREAM-MERGE-GUIDE.md`](../../governance/UPSTREAM-MERGE-GUIDE.md) §4.7 `bun.lock` 处理

## Follow-ups(留 backlog)

1. **删老 Hono office routes**(`packages/opencode/src/server/routes/instance/file.ts:194-269`)— 不阻塞,何时方便何时做,1 笔小 commit
2. **fork-only `file-office.ts` schema 是否要 `withStatics(zod)` 暴露 `.zod` 访问器** — 当前没加,看 file-tabs.tsx 实测是否调 `.zod.parse(...)`,不调可不加
