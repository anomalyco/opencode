---
feat-id: office-routes-effect-httpapi
status: spec
related: ./1-spec.md
---

# office-routes-effect-httpapi — spec

## 触发原因

2026-05-03 sync upstream merge 尝试中**确诊 blocker**:上游把 opencode CLI 重构到 Effect HttpApi(`OPENCODE_SDK_OPENAPI=httpapi` 默认),CLI src 用 `SessionMessage` / `SessionMessageAssistant` 等只在 httpapi-gen SDK 里有的 type;fork 的 `packages/app/src/pages/session/file-tabs.tsx` 用 `sdk.client.file.officePdf` / `sdk.client.office.tooling` 是 fork 加的 **Hono routes**,只在 `OPENCODE_SDK_OPENAPI=hono` 生成的 SDK 里有。

| SDK 模式 | opencode CLI typecheck | fork file-tabs typecheck |
|---|---|---|
| `httpapi`(默认) | ✅ | ❌ 缺 office routes |
| `hono` | ❌ 缺 SessionMessage* 等新 type | ✅ |

**互斥** — gen 文件出来只能选一种 shape。要么:① 把 fork office routes 迁到 Effect HttpApi PublicApi(让 httpapi SDK 也有它们);② 接受 file-tabs.tsx 走 raw fetch 绕开 SDK gen。

按 user 的"稳定 + 跟上上游 + 永久解决"三原则,选 ① — 一次到位永久 align upstream SDK 路径,future merge 这条路径永远 0 冲突。

详细 sync attempt 记录见 [`docs/features/sync-2026-05-03-aborted/3-changelog.md`](../sync-2026-05-03-aborted/3-changelog.md)。

## 需求

### 功能验收

- [ ] httpapi-mode SDK gen(`OPENCODE_SDK_OPENAPI=httpapi bun run --cwd packages/sdk/js build`)产出的 `types.gen.ts` / `sdk.gen.ts` **包含** fork 的 4 个 office routes
- [ ] `packages/app/src/pages/session/file-tabs.tsx` 中 `sdk.client.file.officePdf()` / `sdk.client.office.tooling.{status,install,progress}()` 调用 typecheck 通过
- [ ] opencode CLI typecheck 通过(`SessionMessage*` 等新 type 仍正常 import)
- [ ] DeskFox.exe build 通过
- [ ] 实测 .docx / .pptx 文件 office viewer 正常工作(走 `/file/office-pdf`)+ 实测 LibreOffice 安装入口正常(走 `/office-tooling/{status,install,progress}`)

### 非功能验收

- [ ] **fork-only 路由 schema 定义集中**:office route 的 schema 文件**不分散**,集中在一处便于维护(对应 `packages/opencode/src/server/routes/instance/httpapi/groups/file.ts` 加 fork-marked block,或者新建 fork-only 文件 `office-fork.ts` 注入)
- [ ] **保留 Hono 老 route 还是删?**(决策见 §架构选型)
- [ ] FORK marker 完整,future agent 能 grep 找到 office route 全部 fork 改动

## 架构选型

### 上游 PublicApi 模式(摘录,完整在 `httpapi/groups/file.ts`)

```ts
// schema 定义(包含 path/query 参数)
export const FileQuery = Schema.Struct({
  path: Schema.String,
})

// route 路径常量
export const FilePaths = {
  findText: "/find",
  findFile: "/find/file",
  list: "/file",
  content: "/file/content",
  // ...
} as const

// API endpoint 声明(包含 success schema + OpenAPI annotation)
export const FileApi = HttpApi.make("file")
  .add(
    HttpApiGroup.make("file")
      .add(
        HttpApiEndpoint.get("content", FilePaths.content, {
          query: FileQuery,
          success: described(File.Content, "File content"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.read",
            summary: "Read file",
            description: "...",
          }),
        ),
        // ... 更多 endpoint
      ),
  )
```

handler 在 `httpapi/handlers/file.ts`:

```ts
export const fileHandlers = HttpApiBuilder.group(InstanceHttpApi, "file", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* File.Service
    const content = Effect.fn("FileHttpApi.content")(function* (ctx: { query: { path: string } }) {
      return yield* svc.read(ctx.query.path)
    })
    return handlers.handle("content", content)
  }),
)
```

### Fork office routes 当前 Hono 实现(在 `packages/opencode/src/server/routes/instance/file.ts`)

| Route | Path | 输入 | 输出 |
|---|---|---|---|
| `file.officePdf` | GET `/file/office-pdf` | query: `{ path: string }` | binary PDF bytes(`application/pdf`)|
| `office.tooling.status` | GET `/office-tooling/status` | (无)| `ToolingStatus` JSON |
| `office.tooling.install` | POST `/office-tooling/install` | (无)| `ToolingStatus` JSON(立即返回,后台异步)|
| `office.tooling.progress` | GET `/office-tooling/progress` | (无)| `InstallProgress` JSON |

### 选定方案:**集中加 fork block 到上游 file.ts**

不另建 fork-only 文件,理由:
- Effect HttpApi 的 `HttpApiGroup` 必须 chain 在一个 `.add()` 调用里,跨文件拆分不方便(需要 mutate group / re-build,反而复杂)
- 在上游 `httpapi/groups/file.ts` 用 `// FORK-BEGIN: office routes ...` 块标 fork 改动,future merge 时上游若改 `FileApi` 结构,fork 块直接 conflict resolution 即可
- handler 文件 `httpapi/handlers/file.ts` 同样加 fork block

加 fork-only schema 文件 `packages/opencode/src/server/routes/instance/httpapi/groups/file-office.ts` 收口纯 fork 的 schema 定义(`OfficeToolingStatus` / `OfficeInstallProgress`):
- 这些 schema **不依赖上游任何 file.ts 内的 schema**,完全独立
- 在 file.ts(上游)的 fork block 内 `import { ... } from "./file-office"` 引入
- merge 时 file-office.ts 是 fork-only 文件 → 0 冲突,只 file.ts 的 fork block 行可能跟上游同区域改动撞

### Hono 老 route 处理:**保留**(临时,长期删)

理由:
- `OPENCODE_SDK_OPENAPI=hono` 模式下其他 fork 工具/脚本可能仍依赖 Hono SDK shape(虽然实测 file-tabs.tsx 是唯一 office 调用方,但避免遗漏)
- Hono `file.ts` 中 office routes 为纯增量,不在 fork 黑名单复杂区,删除工作量小但风险不为零
- 当 PublicApi 实现 + 验证全过后,**单独开 1 笔 commit 删 Hono 版本**,做 cleanup
- 短期共存:同一服务 listen 两个 path 的副作用无 — Hono 和 HttpApi 各自 routing,互不干扰

## 实施计划

### Phase 1: 在 sync upstream merge 期间落地

> 本 feat 的代码 commit **不能在 dev 上独立做**(PublicApi infra 在 dev 上不存在)。需要在下一次 sync upstream merge 期间,作为 merge 的一部分落地。

具体步骤(在 sync 分支上,merge 到一半时):

1. **解完上游必要的 conflicts(playbook §4.6 顺序)** — 让 `packages/opencode/src/server/routes/instance/httpapi/` 整套 infra 进 fork
2. **新建 `httpapi/groups/file-office.ts`(fork-only)**:
   ```ts
   import { Schema } from "effect"

   // FORK: office tooling status/install/progress schema for /office-tooling/* routes 2026-05-XX
   export const OfficeInstallProgress = Schema.Struct({
     phase: Schema.Literals(["idle", "probing", "downloading", "installing", "done", "error"]),
     bytesDownloaded: Schema.optional(Schema.Number),
     bytesTotal: Schema.optional(Schema.Number),
     percent: Schema.optional(Schema.Number),
     speedBps: Schema.optional(Schema.Number),
     message: Schema.optional(Schema.String),
     mirrorName: Schema.optional(Schema.String),
   }).annotate({ identifier: "OfficeInstallProgress" })

   export const OfficeToolingStatus = Schema.Struct({
     installed: Schema.Boolean,
     sofficePath: Schema.optional(Schema.String),
     platformSupported: Schema.Boolean,
     downloadSizeMB: Schema.optional(Schema.Number),
     selectedMirror: Schema.optional(Schema.Struct({
       name: Schema.String,
       url: Schema.String,
     })),
     progress: OfficeInstallProgress,
   }).annotate({ identifier: "OfficeToolingStatus" })

   export const OfficePdfQuery = Schema.Struct({
     path: Schema.String,
   })
   ```

3. **改 `httpapi/groups/file.ts`(上游文件,加 FORK block)**:
   - import: `import { OfficeInstallProgress, OfficeToolingStatus, OfficePdfQuery } from "./file-office"`
   - `FilePaths` 加 4 个新 path:
     ```ts
     officePdf: "/file/office-pdf",
     officeToolingStatus: "/office-tooling/status",
     officeToolingInstall: "/office-tooling/install",
     officeToolingProgress: "/office-tooling/progress",
     ```
   - `FileApi` group 加 4 个 endpoint(详细见 §endpoint 模板 below)

4. **改 `httpapi/handlers/file.ts`(上游文件,加 FORK block)**:
   - import: `import * as LibreOffice from "@/file/libreoffice"` + `import * as OfficeInstaller from "@/file/office-installer"`
   - 加 4 个 handler:
     ```ts
     const officePdf = Effect.fn("FileHttpApi.officePdf")(function* (ctx: { query: { path: string } }) {
       const bytes = yield* Effect.promise(() => LibreOffice.convertToPdf(ctx.query.path).catch(() => undefined))
       if (!bytes || bytes.length === 0) return yield* Effect.fail(new Error("conversion failed"))
       return bytes  // Effect HttpApi 的 binary 返回机制 — 待验证(可能要用 HttpResponse.uint8Array 或类似)
     })
     // ... status / install / progress 类似,各调 OfficeInstaller.{status,startInstall,getProgress}
     ```
   - `.handle("officePdf", officePdf)` 等链式注册

5. **typecheck + SDK regen 验证**:
   ```bash
   bun turbo typecheck --force
   bun run --cwd packages/sdk/js build  # 默认 httpapi 模式
   grep "officePdf\|officeToolingStatus" packages/sdk/js/src/v2/gen/sdk.gen.ts  # 应有
   ```

6. **build 验证**:
   ```powershell
   .\packages\branding\scripts\build-deskfox.ps1 -Env dev -NoBundle
   ```

7. **删 Hono 老版**(单独 follow-up commit,不在 sync merge 同笔):
   - `packages/opencode/src/server/routes/instance/file.ts` 删 `/file/office-pdf` 和 3 个 `/office-tooling/*` Hono route block(line 194-269 区间,具体行号 sync 后再看)

### Endpoint 模板(填进上游 file.ts FORK block)

```ts
// FORK-BEGIN: office routes — fork-only Hono routes 迁到 PublicApi 2026-05-XX
// 见 docs/features/office-routes-effect-httpapi/
HttpApiEndpoint.get("officePdf", FilePaths.officePdf, {
  query: OfficePdfQuery,
  success: Schema.Uint8Array,  // 或类似 binary 类型,API 待查
}).annotateMerge(
  OpenApi.annotations({
    identifier: "file.officePdf",
    summary: "Office file as PDF",
    description: "Convert an office document to PDF via LibreOffice and return bytes.",
  }),
),
HttpApiEndpoint.get("officeToolingStatus", FilePaths.officeToolingStatus, {
  success: described(OfficeToolingStatus, "Office tooling status"),
}).annotateMerge(OpenApi.annotations({
  identifier: "office.tooling.status",
  summary: "Get office tooling install status",
})),
HttpApiEndpoint.post("officeToolingInstall", FilePaths.officeToolingInstall, {
  success: described(OfficeToolingStatus, "Office tooling status (post-install start)"),
}).annotateMerge(OpenApi.annotations({
  identifier: "office.tooling.install",
  summary: "Start office tooling install",
})),
HttpApiEndpoint.get("officeToolingProgress", FilePaths.officeToolingProgress, {
  success: described(OfficeInstallProgress, "Install progress"),
}).annotateMerge(OpenApi.annotations({
  identifier: "office.tooling.progress",
  summary: "Poll office tooling install progress",
})),
// FORK-END
```

### 待验证 / risk 点(merge 时现场 dig)

- **binary response**:Effect HttpApi 处理 PDF binary 的具体 API(`Schema.Uint8Array` 是否可用?或要走 `HttpResponse.uint8Array` 的 sub-pattern?)
- **OperationId 命名**:fork-added route 用 `file.officePdf` / `office.tooling.status`,跟上游 naming 风格(`file.read` / `find.text`)对齐就好,但 `office.*` 这个新 namespace 上游没有,要不要单独 group?可考虑用 file group 内的 sub-route(简单)或新 OfficeApi group(纯洁)
- **handler 调用 fork-only `LibreOffice` / `OfficeInstaller`**:这俩 fork 文件 import 路径已在 sync 中跟 `@opencode-ai/core/global` rename 适配过(见 sync changelog),merge 时确认 import 没坏
- **fork-only `file-office.ts` schema 是否要加 `withStatics(zod)`**:看 file-tabs.tsx 用 SDK 是否调 `.zod.parse(...)`,如不调可省

### Effort 估计

- Phase 1(merge 期间):**~4-6 小时**(包含 dig binary response API + 写 schema/handler + verify SDK gen + 实测 office viewer)
- Phase 2(单独 cleanup commit 删 Hono 老 route):**~30 分钟**

## 关联

- 触发文档:[`docs/features/sync-2026-05-03-aborted/3-changelog.md`](../sync-2026-05-03-aborted/3-changelog.md)
- 上游参考:`packages/opencode/src/server/routes/instance/httpapi/groups/file.ts` + `httpapi/handlers/file.ts`(在 upstream/dev,merge 后才在 fork 上)
- Fork 现有 Hono 实现:`packages/opencode/src/server/routes/instance/file.ts:194-269`(merge 前查这版本)
- Fork office 业务逻辑(handler 调的):`packages/opencode/src/file/libreoffice.ts` + `packages/opencode/src/file/office-installer.ts`
- Fork 消费方:`packages/app/src/pages/session/file-tabs.tsx:1182-1198, 1216-1236`

## 不做什么

- **不预迁 dev**:PublicApi infra 在 dev 上不存在,预 do 等于在虚空写代码。等下次 sync merge 一起做
- **不动 office viewer 业务逻辑**(LibreOffice / OfficeInstaller):本笔只换 wire(SDK route → handler 之间),业务逻辑保持不变
- **不重设计 office tooling status / progress 的 shape**:维持现状(之前 fork 用 Zod 定义的 shape 翻译成 Effect Schema 即可),不顺手做 schema 演进
