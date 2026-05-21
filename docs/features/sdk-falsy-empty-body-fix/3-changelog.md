---
feat-id: sdk-falsy-empty-body-fix
status: done
related: ./3-changelog.md
---

# sdk-falsy-empty-body-fix — changelog

## 一句话

`server.ts wrappedFetch` 加 layer 2 兜底 — fetch 成功但 response 4xx/5xx 且 body 空字符串时主动抛有效 Error 截断 SDK fallback,补 [sdk-falsy-error-fallback-fix](../sdk-falsy-error-fallback-fix/3-changelog.md)(2026-05-12 surface fix)未盖的路径 ②;**5.21.1-dev ship 翻车真凶**。

> Tiny / Medium 边界 — 2 改 1 新 文件(server.ts +60、server.test.ts +95、3-changelog.md +1)/ 0 R4 / 0 上游侵入 / 0 测试 skip。

## 起源(2026-05-21 5.21.1-dev Mac 首次 Tier 2 ship 翻车)

Mac 端首次 Tier 2 预览版 ship,user 装上启动直接撞错误页:

```
出了点问题 / 加载应用程序时发生错误
Error: Unknown error
  be@tauri://localhost/assets/index-h8EungwB.js:1:10392
  @tauri://localhost/assets/index-h8EungwB.js:1:3248
原因:{}
```

同病症与 5.11.x 翻车一致。**已有 surface fix** [`sdk-falsy-error-fallback-fix`](../sdk-falsy-error-fallback-fix/3-changelog.md)(2026-05-12)应该挡住,但**没挡住**,说明屏障漏路径。

## 调查 (≈ 1.5 h)

诊断顺序:

1. **Build 流程验**:pack-installer.sh --env dev 正常,产物 .dmg 64MB OK,文件命名规则验证(`DeskFox-Dev-2026.5.21.1_aarch64.dmg`,strip `-dev` 后缀,是 [ship-scripts-naming-fix](../ship-scripts-naming-fix/3-changelog.md) 实战首验)
2. **Backend / sidecar 健康** — `~/Library/Logs/ai.deskfox.app.dev/*.log` 显示 `Sidecar health check OK / Loading done`,全程 0 ERROR / 0 WARN
3. **terminal 启 raw binary + RUST_LOG=debug 抓 stderr**:全 DEBUG 级别 HTTP 调用都 connect 成功 (200),0 ERROR,**确认问题在 frontend webview console,Rust stderr 抓不到**
4. **Safari Web Inspector 路径死路**:tauri release build 未启用 devtools(`tauri.conf.json` / `Cargo.toml` 都无 `devtools` feature),Safari 远程检查连不上
5. **纯 source 分析定位**:`packages/app/src/utils/server.ts:21` 的 5-12 注释自己写明:
   > 真凶:SDK `client.gen.ts:102 / 220` 有 `finalError || ({} as unknown)`
   - 102 行 = path ①(fetch.throw falsy)— 5-12 surface fix 已盖
   - **220 行 = path ②(fetch 成功 + response 4xx/5xx + empty body)— 没盖**
6. **path ② 走 trace**(SDK `client.gen.ts:215-225`):
   ```typescript
   const textError = await response.text()      // 空 body → ""
   const error = jsonError ?? textError          // ""
   let finalError = error                         // ""
   finalError = finalError || ({} as string)     // {}
   if (opts.throwOnError) throw finalError        // throw {} 💥
   ```
   `global-sdk.tsx:231` 的 sdk 设 `throwOnError: true`,任何返回 empty body 4xx 的 endpoint 都触发。

## 触发条件(诊断推论)

`~/Library/Application Support/ai.deskfox.app.dev/` 累积了 stale workspace state(`opencode/` 子目录 2026-05-09 创建,多个 `opencode.workspace.*.dat` 跨 5-12/5-20/5-21 累积)。5.21.1-dev 启动恢复某个失效的 workspace/session → sdk 调 sidecar `/session/<old_id>` 返回空 body 404 → 命中 path ② → throw `{}`。

`packages/opencode/src` 自 5-11 0 改动(sidecar binary 不是 stale)。`packages/desktop/src-tauri` 改了 large-file-preview-guard 的 `get_file_size` 等 Rust commands,正常 register,不是直接触发点。

## 修法

在 `wrapFetchWithFalsyGuard`(原 wrappedFetch 改 export 函数,见下)的 baseFetch 成功 return 后追加 layer 2 检查:

```typescript
// layer 2:4xx/5xx + empty body 兜底(2026-05-21 5.21.x ship 翻车真凶)
if (!response.ok) {
  let bodyIsEmpty = false
  try {
    const cloned = response.clone()
    const text = await cloned.text()
    bodyIsEmpty = text.length === 0
  } catch (cloneError) {
    // clone() / text() 自己挂了不掩盖原 response,继续传给 SDK 走它的正常 path
    console.warn("[FETCH-EMPTY-BODY-CHECK-FAILED]", cloneError)
  }
  if (bodyIsEmpty) {
    const url = ...
    console.error("[FETCH-EMPTY-BODY-ERROR]", { url, status: response.status })
    throw new Error(`Server returned ${response.status} with empty body: ${url}`)
  }
}
return response
```

`response.clone()` 保证消费 body 不影响 SDK 后续 read(Response body 是 single-shot stream)。

### 顺手修 layer 1 latent bug

写测试时发现 5-12 surface fix 的 isEmpty 判断:
```typescript
const isEmpty = e == null || (typeof e === "object" && Object.keys(e as object).length === 0)
```
**Error 对象 `Object.keys` 返回 `[]`**(message/stack 非 enumerable),导致**有效 Error 被错判 empty**,转 "fetch returned empty rejection: ..." 包装。无线上影响(SDK 仍能 handle 有效 Error),但错误信息不精确。本笔加 `!(e instanceof Error)` 排除条件 + `e === ""` 显式 case。

### extract 成 export 函数

原 `wrappedFetch` 是 createSdkForServer 内部 closure,不可测。本笔 extract 成 `export function wrapFetchWithFalsyGuard(baseFetch)`,createSdkForServer 调 `wrapFetchWithFalsyGuard(config.fetch ?? globalThis.fetch)`,**0 行为变化**,但 unit test 可直接 import 测。

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/app/src/utils/server.ts` | extract + 加 layer 2 + 修 layer 1 latent | wrappedFetch 改 export 函数 `wrapFetchWithFalsyGuard`,加 layer 2 empty body 4xx 兜底,layer 1 isEmpty 排除 Error instance |
| `packages/app/src/utils/server.test.ts` | 新建,13 单测全过 | layer 1 (5 测) + layer 2 (6 测) + input 类型兼容性 (2 测) |
| `docs/features/sdk-falsy-empty-body-fix/3-changelog.md` | 新建 | 本文 |
| `本仓 改动日志.md` | +1 行索引 | 同笔加 |
| `docs/features/INDEX.md` | +1 行 | 同笔加 |

> Tiny + 测试豁免规模升级:严格按 CLAUDE.md R5 规则 bug fix 必须含复现测试,所以总文件数 5。spec/plan 信息直接合并到 changelog,符合 Tiny 改动"只写 3-changelog.md"的规则。

## 验证

- `bun test src/utils/server.test.ts` → 13/13 pass(layer 1 五种 reject 类型 + layer 2 四种 status/body 组合 + Request/URL 兼容性)
- 重 pack-installer.sh --env dev --no-bump 出新 .dmg(版本号仍 2026.5.21.1-dev,N 不变),user 装 → 应正常启动到主界面,不再撞 ErrorBoundary

## 后续 backlog

- **L1 防御**:启动恢复 workspace state 前 ping 一下 server,workspace 引用 stale id 时跳过恢复(避免触发 4xx)
- **dev channel 启用 devtools**:`tauri.conf.json` 加 `"devtools": true`(仅 Tier 2 配置)或 Cargo 加 `devtools` feature,让未来 Safari Inspector 路径走通。**会增加 binary size + 暴露调试入口**,需评估是否仅 dev 启用。
- **真根因**:`fetch returned empty body 4xx` 时,sidecar 为何空 body?sidecar 应该返回 JSON error response(`{"error":...}`)而不是空 body。属于 opencode-cli 行为问题,跨上游修。
