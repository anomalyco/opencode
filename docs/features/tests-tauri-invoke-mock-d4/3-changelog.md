---
feat-id: tests-tauri-invoke-mock-d4
status: done
related: ./3-changelog.md
---

# 3-changelog — D4 Tauri invoke mock setup + inlineLocalImages 100% 覆盖

## 起源

D 系列任务(D1-D4 全做,Claude 定顺序 D4 → D3 → D1 → D2)的第 1 笔。

D4 目标:建立 `@tauri-apps/api/core` 的 `invoke` mock 模式,顺手把 `md-export-docx.ts` 的最后一个 helper `inlineLocalImages` 推到 100% 覆盖。

## 改动清单

### 修改

- `packages/app/src/utils/md-export-docx.ts`:
  - `inlineLocalImages` 加 `export`(原 file-private)
  - `// FORK: export for unit tests(R5 决策 2 / D4 — Tauri invoke mock)2026-05-07`

### 新文件 — `md-export-docx-inline.test.ts`(~180 行 / 22 测试)

**单独 test 文件设计**:`mock.module` 影响整个 module,放进既有 `md-export-docx.test.ts` 会污染那 45 个同步测试。新建文件单一职责:专测 `inlineLocalImages` + 必要的 invoke mock。

#### Mock 模式(D4 setup,后续可复用)

```ts
let invokeImpl: InvokeFn = async () => { throw new Error(...) }
const invokeCallLog: Array<{ cmd: string; args }> = []

beforeAll(async () => {
  mock.module("@tauri-apps/api/core", () => ({
    invoke: (cmd, args) => {
      invokeCallLog.push({ cmd, args })
      return invokeImpl(cmd, args)
    },
  }))
  const mod = await import("./md-export-docx")
  inlineLocalImages = mod.inlineLocalImages
})

beforeEach(() => {
  invokeCallLog.length = 0
  invokeImpl = async () => { throw ... }
})
```

每个测试 setup 自己的 `invokeImpl` 行为(同步 / 异常 / 返回值 / 计数器递增等)。`invokeCallLog` 让测试断言"调了几次"。

### 22 测试覆盖

| 组 | 测试数 | 重点 |
|---|---|---|
| **早返回路径(0 invoke 调用)** | 3 | mdFileDir 缺 / 空 md / 纯文字无图 |
| **外链跳过(0 invoke 调用)** | 8 | http / https / data: / blob: / file: / localasset: / 协议相对 // / 锚点 # |
| **本地图片识别 + 替换** | 9 | 相对路径 + 成功 / title 保留 / 不识别扩展跳过 / **invoke 失败保留原文** / **percent-encoded 解码** / 多张并发 / 混合外链+本地 / absolute 路径 / invoke 参数 root="" 校验 |
| **alt 文本保留** | 2 | 空 alt / 含中文 alt |

## 测试结果

```
$ bun test src/utils/md-export-docx-inline.test.ts
22 pass / 0 fail (49 expect calls / 314ms)

$ bun run test:unit (full suite)
436 pass / 1 fail (kobalte SSR 老坑无关)
415 → 437 (+22 全 pass)
```

## 关键模块覆盖率推进

| 文件 | 之前 | 本笔后 | 达 80%? |
|---|---|---|---|
| **`md-export-docx.ts`** | ~87.5%(7/8 helpers)| **~100%(8/8 helpers)** ⬆ | ✅ 全覆盖 |
| `markdown-editor-extensions.ts` | ~17% | ~17% | ✗ — D3 范围 |
| `dialog-settings.tsx` | 0% | 0% | ✗ — D1 范围 |
| `file-tabs.tsx` | 0% | 0% | ✗ — D2 范围 |

`md-export-docx.ts` 是关键模块清单**首个达 100% 覆盖**的文件。

## D 系列任务进度

```
D4 (Tauri invoke mock + inlineLocalImages 100%):  ✓ done(本笔)
D3 (CodeMirror EditorView fixture):               下一笔
D1 (SolidJS component test setup):                后续
D2 (file-tabs.tsx ~2000 行):                      最后
```

## 后续 mock 模式复用价值

D4 建立的 `mock.module("@tauri-apps/api/core")` 模式可复用到:
- `markdown-editor.handleImageDrop`(D3 路径)
- `markdown-editor.handlePasteHook`(D3 路径)
- 其他 file-tree dnd / save dialog 等所有 Tauri invoke 调用点

未来引入时直接复用本笔的 `invokeImpl` + `invokeCallLog` 模式。

## 规模 / R 标记

- 规模:Tiny(~180 行测试 / +1 行 export 注解 / 2 文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:✓
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:本 feat 是测试,自然满足
