---
feat-id: office-routes-effect-httpapi
status: done
related: ./1-spec.md ./3-changelog.md
---

# office-routes-effect-httpapi — changelog

## 实施

按 [`1-spec.md`](./1-spec.md) 模板,在 sync-2026-05-03-2 期间一次落地(详细 sync 上下文见 [`../sync-2026-05-03-2/3-changelog.md`](../sync-2026-05-03-2/3-changelog.md))。

## 改动文件(3 个,~90 行净增)

### NEW `packages/opencode/src/server/routes/instance/httpapi/groups/file-office.ts`(40 行,fork-only)

集中所有 office route 的 Schema 定义:
- `OfficePdfQuery` — 查询 schema(单 `path: string`)
- `OfficePdfBytes` — `Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({contentType: "application/pdf"}))` — **spec "binary response API" 待 dig 项落定**
- `OfficeInstallProgress` / `OfficeToolingStatus` — install 状态/进度 schema

### EDIT `packages/opencode/src/server/routes/instance/httpapi/groups/file.ts`(+27 行 FORK block)

- import `OfficePdfQuery` / `OfficePdfBytes` / `OfficeInstallProgress` / `OfficeToolingStatus` from `./file-office`
- `FilePaths` 加 4 个 path 常量(`officePdf` / `officeToolingStatus` / `officeToolingInstall` / `officeToolingProgress`)
- `FileApi` group 加 4 个 `HttpApiEndpoint`(在 `// FORK-BEGIN: office routes ...` 块内)
  - `officePdf`:GET `/file/office-pdf`,query `OfficePdfQuery`,success `OfficePdfBytes`(binary)
  - `officeToolingStatus`:GET `/office-tooling/status`,success `OfficeToolingStatus`(JSON)
  - `officeToolingInstall`:POST `/office-tooling/install`,payload `Schema.Struct({})`,success `OfficeToolingStatus`
  - `officeToolingProgress`:GET `/office-tooling/progress`,success `OfficeInstallProgress`

### EDIT `packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts`(+30 行 FORK block)

- import `path` + `* as LibreOffice from "@/file/libreoffice"` + `* as OfficeInstaller from "@/file/office-installer"`
- 4 个 `Effect.fn` handler 在 `// FORK-BEGIN: office routes handlers` 块:
  - `officePdf`:`InstanceState.context` 拿 directory → `path.join` 拼 full path → `LibreOffice.convertToPdf` → 返 `Uint8Array`
  - `officeToolingStatus`:调 `OfficeInstaller.status()`
  - `officeToolingInstall`:启动 `OfficeInstaller.startInstall()` 后立即返回 `OfficeInstaller.status()`(背景跑下载/安装)
  - `officeToolingProgress`:调 `OfficeInstaller.getProgress()`
- handler 注册:`.handle("officePdf", officePdf)` 等 4 行,在原 `.handle("status", status)` 后

## 验证

| 项 | 结果 |
|---|---|
| `bun run --cwd packages/sdk/js build`(httpapi default 模式) | 通过 ✅ |
| `grep "officePdf\|officeToolingStatus" packages/sdk/js/src/v2/gen/sdk.gen.ts` | 4 个 method 全在 ✅ |
| SDK 结构:`client.file.officePdf()` + `client.office.tooling.{status, install, progress}()` | 跟 fork file-tabs.tsx 调用方式一致 ✅ |
| `bun turbo typecheck --force`(全 monorepo) | 15/15 successful ✅ |
| `build-deskfox.ps1 -Env dev -NoBundle` | DeskFox.exe ready(75s)✅ |
| office viewer 打开 .docx/.pptx → PDF 走 HttpApi `/file/office-pdf` | 待 user 自验 |
| LibreOffice 安装入口走 `/office-tooling/*` | 待 user 自验 |

## 影响范围

### 本次直接收益
- httpapi-mode SDK 包含 fork 的 4 个 office routes
- fork file-tabs.tsx 既能用上游新 type(`SessionMessage*`)又能用 fork office method,**SDK 双路径互斥 blocker 永久解决**
- 老 Hono 路由暂时保留(在 `packages/opencode/src/server/routes/instance/file.ts`),跟 HttpApi 共存,以便 backward compat;follow-up 单独 commit 删

### 长期
- 以后 fork 加新 backend route **不要再走 Hono 直加**,先评估 PublicApi 模式;Hono 路径已是技术债(详 UPSTREAM-MERGE-GUIDE TL;DR §8)
- 上游若再大改 PublicApi 结构,fork block 会撞 conflict;但 fork block 是用 FORK-BEGIN/END marker 圈定,merge 时易识别 + 易解
- `withStatics(zod)` 没加在 `OfficeToolingStatus` / `OfficeInstallProgress` 上 — 看 file-tabs.tsx 实测是否需 `.zod.parse(...)` 解码 client 数据;如不需,简洁性胜出

### 风险
- handler 内 `LibreOffice.convertToPdf` 同步抛 error(目前用 `.catch(() => undefined)` 兜)→ 实测看 client 拿到空 Uint8Array 时 PDF viewer 是否优雅退化
- `officeToolingInstall` 当前是"启动 + 立即返回 status"(background install),client polling `progress` 看进度。如果 user 期望"等待安装完才 200 OK",要改 handler 等 `startInstall` resolve 才 return —— **不在本笔 scope**

## R4 override

**无**(本次落地全在 sync 期间,作为 sync merge 同笔包含;R4 override 计在 sync-2026-05-03-2 名下,该 commit 0 R4)。

## Follow-ups

1. **删老 Hono office routes**(file.ts:194-269)— 1 笔小 commit,不阻塞
2. 上游若 PR 加更多 file group endpoint,review 是否影响 fork FORK block 位置
3. 实测 office viewer 端到端工作正常 → 可标 spec status 真 done
