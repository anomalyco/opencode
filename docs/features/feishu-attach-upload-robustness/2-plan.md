---
feat-id: feishu-attach-upload-robustness
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-attach-upload-robustness — 2-plan(实施计划)

## 规模:Medium-(~100 行代码 + ~100 行测试 + 三文档)

## 实施顺序

### Phase 1 — `file-uploader.ts` 改造(~70 行)

**1.1** 改 stream → Buffer

```diff
-import { createReadStream, statSync } from "node:fs"
+import { readFileSync, statSync } from "node:fs"

 export async function uploadImage(client: Client, path: string): Promise<string> {
   const size = statSync(path).size
   if (size > MAX_IMAGE_BYTES) { ... }
-  const res = await client.im.v1.image.create({
-    data: { image_type: "message", image: createReadStream(path) },
-  })
+  const buffer = readFileSync(path)
+  const res = await retryUpload(
+    () => client.im.v1.image.create({
+      data: { image_type: "message", image: buffer },
+    }),
+    `image ${basename(path)}`,
+  )
   ...
 }
```

`uploadFile()` 同样改造。

**1.2** 新加 `retryUpload<T>(fn, label)` helper

```ts
/** 可恢复错误模式 — socket / network / timeout / 5xx / ECONNRESET / EPIPE */
const RECOVERABLE_PATTERNS = [
  /socket.*closed/i,
  /econnreset/i,
  /epipe/i,
  /network.*error/i,
  /timeout/i,
  /\b5\d{2}\b/, // 5xx HTTP status
]

function isRecoverable(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err)
  return RECOVERABLE_PATTERNS.some((re) => re.test(msg))
}

const RETRY_DELAYS_MS = [1000, 3000] // 重试 2 次

async function retryUpload<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await withTimeout(fn(), UPLOAD_TIMEOUT_MS, label)
      if (attempt > 0) {
        console.log(`[file-uploader] ${label} 重试第 ${attempt} 次成功`)
      }
      return result
    } catch (err) {
      const final = attempt >= RETRY_DELAYS_MS.length
      const recoverable = isRecoverable(err)
      if (final || !recoverable) {
        if (attempt > 0) {
          console.warn(`[file-uploader] ${label} 重试 ${attempt} 次最终失败:`, (err as Error).message)
        }
        throw err
      }
      const delay = RETRY_DELAYS_MS[attempt]!
      console.warn(
        `[file-uploader] ${label} 第 ${attempt + 1} 次失败,${delay}ms 后重试:`,
        (err as Error).message,
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw new Error(`[file-uploader] ${label} unreachable — retry loop logic error`)
}
```

**1.3** 新加 `withTimeout` helper(显式 30s)

```ts
const UPLOAD_TIMEOUT_MS = 30_000

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timeout after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
```

注意:Lark SDK 不接受 AbortSignal,只能用 Promise.race 实现"超时"(实际请求继续在后台跑,但前端 Promise 已 reject)。这是 SDK 限制,接受。

### Phase 2 — 测试(~100 行)

`file-uploader.test.ts` 加 / 改:

**2.1 retryUpload helper extract 单测**(直接调 helper):
- 成功一次 → 立即返
- 失败 1 次 socket → retry 第 2 次成功 → 返
- 失败 2 次 → retry 第 3 次成功 → 返
- 失败 3 次 → throw
- 失败非可恢复 → 立即 throw 不 retry(business error case:size 超限 / 4xx)
- timeout 触发 → 视为可恢复重试

**2.2 uploadImage / uploadFile 集成测**(扩既有):
- 成功路径:Buffer 上传成功 → 返 key
- socket 失败 → retry → 成功
- size 超限 → 不重试直接抛
- timeout → retry 后最终失败

由于 helper 抽出来了,可以纯函数测,不依赖 Lark Client mock。但 uploadImage / uploadFile 集成仍 mock Lark Client 注 retry-able fake。

### Phase 3 — 收尾

- `bun run typecheck` 16/16
- `bun test packages/adapter-feishu-lark/`(目标:485 + 新 ~13 = ~498 全过)
- Build dev .app 装 /Applications
- user 飞书测让灵狐发 notes.md 是否成功
- 3-changelog + INDEX + 改动日志

## commit 链(预期)

| # | commit message |
|---|---|
| 1 | `docs(feishu-attach-upload-robustness): 1-spec + 2-plan [feat: feishu-attach-upload-robustness]` |
| 2 | `feat(feishu-attach-upload-robustness): file-uploader stream→Buffer + retryUpload + withTimeout helper + 13 单测 [feat: feishu-attach-upload-robustness] [bug-repro: socket disconnect on Bun stream upload]` |
| 3 | `docs(feishu-attach-upload-robustness): 3-changelog + INDEX + 改动日志 [feat: feishu-attach-upload-robustness]` |

## 风险 / 注意点

| 风险 | 缓解 |
|---|---|
| Buffer 上传 30MB 文件内存 spike | 内存代价可接受(Bun VM 默认 4GB);如果未来撞 OOM,改回 stream 加重试或 Layer 2 dispatcher |
| retry 把临时业务错误(401 token 过期)误重试 → 浪费时间 | 401 不在可恢复 pattern;仅 5xx / 网络层 retry |
| timeout 30s 对 30MB 慢网络仍可能不够 | 真撞 timeout 进 retry 路径,3 次总耗 90s 仍未通过 → 给 user 报失败(合理) |
| Lark SDK 内部不支持 AbortSignal | 用 Promise.race 实现,前端 Promise reject 但后端可能仍跑(无害,GC 会收) |
| Bun runtime fetch 兼容性如果 Buffer 也挂 | 极小概率;若真挂会在测试期暴露,届时上 Layer 2(自实现 fetch + form-data) |

## 实施中决策点(开发中 append)

(空 — 开发中遇到再补)
