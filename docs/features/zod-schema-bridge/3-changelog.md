---
feat-id: zod-schema-bridge
status: done
related: ./3-changelog.md
---

# zod-schema-bridge — changelog

## 背景

为下次 `git fetch upstream && git merge upstream/dev` 做 prep。上游正在大规模 Zod → Effect Schema 迁移(2026-05-02 sync 摸到 5 个冲突文件就是证据)。fork 在 `packages/opencode/src/file/index.ts` 上往上游 `Content` schema 的 `encoding` 字段加了 `"office-pdf-ref"` 这个 fork-only 枚举值,触发"同 schema 双改"型冲突(playbook §4.4 类型 5)。

每次 upstream 改 Content schema(可能频率很高,因为 Effect Schema 重构还在持续),fork 都要手解一次"接受上游骨架 + 把 `office-pdf-ref` literal 加回去"。这是常驻冲突源。

## 调研:实际冲突面只有 1 处

跑 `grep` 全 codebase 后定位:

| 文件 | Fork 现状 | Upstream/dev | 冲突? |
|---|---|---|---|
| `packages/opencode/src/file/index.ts:69` `Content.encoding` | `z.enum(["base64", "office-pdf-ref"]).optional()` | `Schema.optional(Schema.Literal("base64"))` | **是** — 双方都改了,语义重叠 |
| `packages/opencode/src/file/index.ts:567-572` 生产者 | 输出 `encoding: "office-pdf-ref"` | 不存在该分支 | 间接 |
| `packages/ui/src/pierre/media.ts:131` 消费者 | `encoding === "office-pdf-ref"` | 不存在 | 间接 |
| `packages/opencode/src/server/routes/instance/file.ts:194` `/file/office-pdf` 路由 | Fork 新增 | 不存在 | **否** — 纯增量 |

其他 fork-touched 文件(`session/llm.ts` plugin-cwd-channel / `session/prompt.ts` claude-code-loop-fix / `file/office-installer.ts` / `file/libreoffice.ts`)**不涉及任何 schema 定义**,跟 effect-zod 迁移无关。fork 也没有自己定义 Zod schema 让上游消费的场景,所以也不需要走 effect-zod adapter。

**结论**:整个 "Zod → Effect Schema 迁移 prep" 任务的真实 scope 就是 `Content.encoding` 这一处的 office-pdf-ref 处理。

## 三种策略对比

### A. side-band 信号(选中)
- 把 `office-pdf-ref` 从 schema 中拿掉,改用 fork-only vendor MIME (`application/x-deskfox-pdf-ref`) 作为侧通道标记
- 协议常量 + 判断函数放 `packages/shared/src/office-pdf-protocol.ts`(server + client 都能 import)
- 生产者 producer 不再设 `encoding`,改用新 mime
- 消费者 consumer 检测从 `encoding === "office-pdf-ref"` 改成 `mimeType === OFFICE_PDF_REF_MIME`
- **结果**:fork 在 `Content` schema 上零字段值依赖,以后 upstream 怎么改 Content,这个 surface 永远 0 冲突 0 思考(只需 take 上游)

### B. 预迁 fork 到 Effect Schema(模仿 upstream 的 `Schema.Struct(...).pipe(withStatics(...))` pattern)
- 把 fork 的 `Content` 整段改写,语言对齐上游
- 但 merge 时仍然 conflict(import 路径 / withStatics 命名 / DeepMutable / 字段顺序都得逐字符模仿才能 0 冲突,实际不可能)
- 而且要追上游 schema pattern 的演进(Effect Schema 还在 churn),fork 跟着 churn = 等于把 fork 焊死到不稳定的 API
- **缺陷**:大重构(~50-100 行)+ 不能真正消除冲突 + 长期维护负担

### C. 现状保留,merge 时现场解
- 0 prep 改动
- 每次 merge 触动 Content schema 时手解 5-10 分钟,**且每次都要记得补 office-pdf-ref**(隐性记忆,易漏 → office 预览静默回归)
- **缺陷**:复发性维护 + 静默风险

### 决策对照"稳定 + 跟上上游"双目标

A 同时满足两条:
- **稳定**:fork 自有 protocol 文件,语义显性,不依赖任何上游字段命名
- **跟上上游**:每次 merge 这一处 0 冲突 0 决策

B 在两条上都打折(伪对齐 + 不能真消冲突);C 牺牲长期换短期省事。

A 是"一次设计永久受益"的隔离方案,完全契合 P1(隔离)/ P3(适配层)/ P4(可逆)三条 fork 设计原则。**选 A**。

## 实现

### NEW `packages/shared/src/office-pdf-protocol.ts`(15 行)
```ts
export const OFFICE_PDF_REF_MIME = "application/x-deskfox-pdf-ref"
export function isOfficePdfRefMime(mime: string | undefined): boolean { ... }
```

vendor MIME 用 RFC 6838 规范的 `application/x-` 前缀 + 厂商命名空间(`deskfox-pdf-ref`),实际 Office/PDF 流不会自然产生该字符串。

### EDIT `packages/opencode/src/file/index.ts`
- **行 6 区**:加 import `OFFICE_PDF_REF_MIME from "@opencode-ai/shared/office-pdf-protocol"` + FORK 单行 marker
- **行 69 schema**:`z.enum(["base64", "office-pdf-ref"])` → `z.enum(["base64"])`(回上游语义,该行不再带 fork 漂移)
- **行 567-572 producer**:删 `encoding: "office-pdf-ref"`,把 `mimeType: "application/pdf"` 换成 `mimeType: OFFICE_PDF_REF_MIME`,加 FORK-BEGIN/END marker

### EDIT `packages/ui/src/pierre/media.ts`
- 加 import `isOfficePdfRefMime from "@opencode-ai/shared/office-pdf-protocol"` + FORK 单行 marker
- 改 `isOfficePdfRef` 函数体:`record?.encoding === "office-pdf-ref"` → `isOfficePdfRefMime(record?.mimeType)`,加 FORK 单行 marker

### 不动的文件
- `packages/sdk/js/src/v2/gen/types.gen.ts:2026` 仍残留 `| "office-pdf-ref"` 在 encoding 联合类型中。**故意不改**:
  - 这是 auto-generated(`@hey-api/openapi-ts`),手编辑会被下次 regen 覆盖
  - 现在已无消费者(media.ts 切换到 mime 检测,opencode 内部不再产 `encoding: "office-pdf-ref"`),为 dead union member
  - 下次 SDK regen 自然清掉

## 验证

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --force`(全 monorepo,无缓存) | **15/15 successful** |
| `build-deskfox.ps1 -Env dev -NoBundle` 端到端 release build | **DeskFox.exe ready**(114s,前端 + Rust + sidecar 全过) |
| 实际 office 文档预览功能 | 待 user 自验(打开 .docx/.pptx → PDF viewer 起来) |

## 影响范围

### 直接收益(本次)
- `Content.encoding` schema 上 fork 字段值依赖归零
- 下次 sync upstream merge 时,Content schema 块的冲突解析变成纯机械"take 上游",不再需要"手补 office-pdf-ref literal"
- office-pdf-ref 协议从隐性约定(藏在 enum 字符串里)转成显性协议(独立 fork-only 文件 + 命名清晰的 vendor MIME)

### 长期收益
- Upstream 还在大规模 Effect Schema 迁移 churn,本笔切完后 fork 完全脱离 Content schema 演进周期
- 协议定义集中在一处(`packages/shared/src/office-pdf-protocol.ts`),producer + consumer 同源,不会因双方各自维护字符串导致漂移

### 风险
- vendor MIME 误匹配:**极低** — `application/x-deskfox-pdf-ref` 不会自然产生
- upstream 给 mimeType 字段加严格校验(如改成 `Schema.Literal(...)`):低 — 当前是 `Schema.optional(Schema.String)`,自由字符串。若收紧会显性 typecheck 失败,非静默回归
- office 预览功能回归:低-中 — 已通过 typecheck + build 验证;实际文档打开待 user 自验

## R4 override

**第 2 笔本季配额**(本季已用 1 笔 = post-sync-build-fix)。3 个黑名单文件触动:

| 文件 | 改动性质 | wrapper 替代为何不可行 |
|---|---|---|
| `packages/shared/src/office-pdf-protocol.ts` (NEW) | fork-only,纯增量 | 这是 wrapper 本身,不是替代项;选 shared/ 因 server+client 都要 import |
| `packages/opencode/src/file/index.ts` | 减 fork 漂移 + 改 producer 4 行 | 行 69 schema 改动是"删 fork 字段值",必须就地;producer 在 `Effect.fn("File.scan")` generator 内部,跨 yield 抽出去要重写控制流,改动量反而大且更脆弱 |
| `packages/ui/src/pierre/media.ts` | 改 fork 函数体 1 行 | `isOfficePdfRef` 是 fork 加的(commit `66c8fa523`),已在 media.ts;挪到新文件要 (a) 删 media.ts 实现仍触动黑名单 (b) 改所有 caller,净增改动且不省 override |

**override 是"投资"而非"开销"**:本笔一次性消耗 1 笔配额,换得 Content schema 上 0 冲突,半年 4 次 merge 累积省 ~30 分钟手工 + 永久消除"漏改 office-pdf-ref"的静默回归风险。

## 回退方法

完全可逆。如果未来 upstream 给 `encoding` 加新 literal 项导致本协议反成累赘,直接:
1. 删 `packages/shared/src/office-pdf-protocol.ts`
2. 把 `file/index.ts:69` 改回 `z.enum(["base64", "office-pdf-ref"])`
3. 把 producer 还原 `encoding: "office-pdf-ref"`
4. 把 media.ts `isOfficePdfRef` 改回 `record?.encoding === "office-pdf-ref"`

无 lock-in。
