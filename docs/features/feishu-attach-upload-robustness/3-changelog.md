---
feat-id: feishu-attach-upload-robustness
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-attach-upload-robustness — 3-changelog

> **状态**:✅ iter 4 + follow-up 落地实测通过(2026-05-24,中文名飞书显示正常)
> **commit 链**:7 commits(spec/plan + iter 2 + iter 2-doc + iter 3 + iter 3-doc + iter 4 + iter 4 follow-up)
> **规模**:Medium ~210 行代码 + ~340 行测试,纯 fork-only,0 上游侵入

## commit 链(完整 iter 0~4 时间轴)

| hash | iter | 内容 | 实测结果 |
|---|---|---|---|
| `983f54646` | docs | 1-spec + 2-plan | — |
| `645bf2a31` | iter 1 | createReadStream → readFileSync raw Buffer + retryUpload + withTimeout + 27 单测 | 装上撞 `source.on is not a function`(被误诊为"SDK 期待 Stream") |
| `ef1b6ae4a` | docs | 3-changelog + INDEX + 改动日志 + 状态置 done | — |
| `83295c161` | iter 2 | Buffer → `Readable.from(buffer)` 包成 in-memory stream(误诊修法) | 装上撞 30s timeout × 3 retry 全 hang |
| `de3904512` | iter 3 | Readable.from → raw Buffer + sanitizeFileNameForUpload + 6 单测 | 装上又撞 `source.on is not a function`(回到 iter 1 同款) |
| `1f6d3cda4` | docs | 回填 iter 3 hash + 改动日志 follow-up | — |
| `8e83f91e6` | **iter 4** | **绕开 SDK,Bun-native fetch + FormData + Blob**;tokenManager 借 token;测试 SDK mock → fetch mock | ✅ 文件传输成功 |
| `6f8fb3746` | iter 4 follow-up | 移除 sanitizeFileNameForUpload 调用 — 中文名展示乱码 | ✅ 中文名正常显示 |

## 教训(2026-05-24 落地,值得未来 plugin/bundle work 反复回顾)

### 教训 1:**iter 1~3 全部死在同一个 axios+form-data 调用栈**,但症状各异让我误诊三次

| iter | 调用形态 | 报错 | 真正机制(事后看清) |
|---|---|---|---|
| 0 / iter 1 | `createReadStream` / raw `Buffer` | `socket connection closed unexpectedly` / `source.on is not a function` | Bun 跨 axios chunked encoding 路径 fail / form-data `Buffer.isBuffer(buf) === false` 把 Buffer 当 stream 处理调 source.on |
| iter 2 | `Readable.from(buffer)` | 30s timeout × 3 hang | form-data 算不出 Content-Length(Readable.from 无 path / _lengthRetrievers)→ 强制 chunked → Feishu server hang |
| iter 3 | raw Buffer 再来一次 | `source.on is not a function`(同 iter 1) | 同 iter 1 — `Buffer.isBuffer` 在 plugin bundle 里 false |

**所有迭代都在 axios(SDK 内置 HTTP transport)+ Node form-data 这条调用链上打转**,每次只换 Buffer / Stream 的形态,本质上根因(plugin bundle 跟 Bun runtime 的 Node 生态包 interop)从来没碰。**iter 4 跳出这条链才一次过**。

### 教训 2:Bun + Node 生态 CJS 包 + bundle 的 Buffer interop 陷阱

`bun build --target=bun` 把 form-data CJS 打进 bundle 时,form-data 内部引用的 `Buffer` 全局跟 runtime `node:fs.readFileSync()` 返回的 Buffer **不是同一个 class**。`Buffer.isBuffer(buf)` instanceof 判断 fail → 误判 stream → 调 `.on()` crash。

**Workaround**:能绕开 Node 生态 CJS 包就绕开,走 Bun-native API(`fetch + FormData + Blob`)— 标准 Web API 在 Bun runtime 内一等公民,无 interop 风险。

### 教训 3:**先认真读 stack trace 再动手改**

iter 3 装完看到 `source.on is not a function`,我没仔细读完整 stack 就当成 iter 1 误诊的延续(以为是"SDK 期待 Stream")。**stack trace 写得很清楚错误在 `plugin/feishu-bridge/dist/plugin.js:2392`,这是 plugin bundle 里的 form-data 代码,跟 SDK 业务调用无关**。早一步看清,iter 4 可以省 2 次失败迭代。

### 教训 4:**别把 OpenClaw 修法照搬,先弄清它在哪个调用链**

OpenClaw `sanitizeFileNameForUpload`(RFC 5987 percent-encoding)是给 **Node form-data 库走 SDK 路径**用的 — 那个路径上 Content-Disposition header 不能含非 ASCII(老 form-data 用 latin-1 编码 header)。iter 4 改用 **Bun-native FormData** 后,Bun 标准走 RFC 8187 自动处理 UTF-8 filename,**percent-encoding 反而会让飞书 server 把 raw 字符串当显示名**(实测中文名变 `%E6%8A%A5%E5%91%8A.md`)。

**Workaround**:**移植兜底逻辑前先想清楚它在哪个调用链生效 / 我们走的是不是同一条链**。iter 3 我直接 `import OpenClaw 同款实现` 没想清这点。

### 教训 5:**sidecar / plugin 重建陷阱 — `need_rebuild_*` 时间戳检查范围太窄**

- `build-deskfox.sh:121-130` 的 `need_rebuild_sidecar` 只看 `packages/opencode/src/**/*.ts`,**adapter-feishu-lark / branding 改动不会触发**
- `build-feishu-plugin.sh:28-38` 的 `need_rebuild` 看 `packages/adapter-feishu-lark/src/**/*.ts`(还行),但**没考虑 transitive deps**

本次撞 iter 2 → iter 3 → iter 4 每次都要**手动删 sidecar binary + plugin.js** 才能确保新代码进 bundle。Backlog 应该补:`packages/adapter-feishu-lark/src` 新于 sidecar mtime → 也要重建 sidecar(adapter 通过 sidecar 内的 plugin loader 跑)。

## iter 4 核心改动

### 文件:`packages/adapter-feishu-lark/src/feishu/file-uploader.ts`

新增 2 个 export helper(R5 helper extract 模式):
- `getClientAuthContext(client)`:从 SDK Client 内部 `tokenManager.getTenantAccessToken({})` 借 tenant_access_token + `client.domain` 拿 domain URL(SDK 内部 cache,免 boilerplate)
- `uploadMultipartViaFetch({endpoint, token, fields, fileFieldName, fileBuffer, fileName, keyField})`:Bun-native `fetch + FormData + Blob` 实现 multipart upload,飞书业务错误 code/msg 翻译成 Error message 让 retry 层 isRecoverableError 判断

重写 `uploadImage` / `uploadFile`:
- size 预检不变
- `readFileSync(path)` 拿 Buffer 不变
- `retryUpload(...)` 包不变
- **内部不再调 `client.im.v1.image.create / .file.create`**,改 `uploadMultipartViaFetch({ endpoint: ${domain}/open-apis/im/v1/{images,files}, ... })`

`sendImageMessage` / `sendFileMessage` **保留 SDK 调用不动**(`client.im.v1.message.create` 非 multipart 工作正常,不需要换)。

### 文件:`packages/adapter-feishu-lark/src/feishu/__tests__/file-uploader.test.ts`

- `makeFakeClient` 重构:`client` 只提供 `tokenManager.getTenantAccessToken` + `domain` + `im.v1.message.create`
- 新加 `installFetchMock / uninstallFetchMock`:`globalThis.fetch` 接管,按 URL 分流 image/file,从 FormData entries 提 fields 字典,按 `imageError / fileError / imageErrorsPerCall / fileErrorsPerCall` opts 抛错
- `makeMock` 包装:auto install + 注册 afterEach uninstall
- 断言改 shape:`imageCalls[0].image_type` → `imageCalls[0].fields.image_type`(同等语义)

### 文件:`packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts`

- `makeAttachFakes` 同款重构:加 tokenManager + domain + fetch mock(install/uninstall)
- `processAttachments` 集成测的 `imageCalls` / `fileCalls` 形式不变(对外接口稳定)
- 1 处 `imageError` 测试加 `uninstall → 重新构造 → install` 替换 mock

## iter 4 follow-up:中文名乱码修法

iter 4 完成后,user 测中文名 `报告.md` 飞书展示成 `%E6%8A%A5%E5%91%8A.md` raw 字符串。
**根因**:iter 3 加的 `sanitizeFileNameForUpload(fileName)` 在 iter 4 的 `uploadFile` 里还在调,把中文 percent-encoded 后塞进 `fields.file_name`,**Bun-native FormData 不需要这个 sanitize**(RFC 8187 自动处理 UTF-8 filename),反而让飞书 server 把 raw encoded 字符串当显示名。

**修法**(commit `6f8fb3746`):`uploadFile` 里 `fields.file_name` 由 `safeName`(sanitized)改回原 `fileName`(中文)。1 行改动。

`sanitizeFileNameForUpload` 函数本身和 5 个单测保留(纯函数无副作用,未来可能用到)— 只是从 `uploadFile` 内部拆掉调用。

## 测试

- typecheck:16/16
- adapter-feishu-lark 套件:518/518(完整 file-uploader 43 个测试 + 全套集成)

### file-uploader 测试明细

- isRecoverableError(12 case):RECOVERABLE_ERROR_PATTERNS 全覆盖 + 业务错误 + 空 / undefined 防御
- withTimeout(3 case):resolve 先 / timeout 先 / 透传错误
- retryUpload(6 case):成功一次 / 1 错+成功 / 2 错+成功 / 3 错 throw / 非可恢复立即 throw / timeout 触发重试
- uploadImage(集成 4 case + retry 4 case)
- uploadFile(集成 5 case + retry 2 case)
- sanitizeFileNameForUpload(5 case,纯函数保留)
- sendImageMessage / sendFileMessage(2 case)

## 风险 / 已知限制

1. **tokenManager 是 SDK internal 字段**(`(client as any).tokenManager`)— SDK 升级如果改名,getClientAuthContext 会抛 "SDK Client 缺 tokenManager"。已加显式错误信息让排查 5 分钟内定位。SDK v1.50 至今未改这两个字段(verified `node_modules/.../lib/index.js:81550-81553`)。
2. **30s timeout 对真慢网络仍可能不够**:30MB / 100KB/s = 300s,iter 4 走 Bun fetch 行为跟 axios 不同,但软 timeout(Promise.race)依然是 timeout 触发 retry → 3 次都超时 → 90s 后失败。
3. **跨平台**:Win 端未测;Bun + native FormData 行为应跟 Mac 一致(Bun runtime 跨平台标准 Web API),但实测等下次双端协作再验。

## 回退方法

`git revert <iter 4 follow-up commit> <iter 4 commit>` 退回 iter 3,但 iter 3 已知不工作(`source.on` crash)— 真要 rollback 需要 revert 到 `645bf2a31` 之前的 `a1fea3053`(原始 createReadStream 版,首批 bug 报告版)。

## 关联

- 上游 ATTACH 实现:`feishu-bridge-light`(2026-05-23)
- 触动文件:`packages/adapter-feishu-lark/src/feishu/file-uploader.ts`(核心)+ 两个测试文件
- 不动:`reply-actions.ts`(ATTACH marker 解析 / 白名单)+ `message-pipeline.ts` 主逻辑(retry/timeout/fetch 都在 file-uploader 内部封装)
- 留 backlog:
  - **`build-deskfox.sh` 时间戳判断扩 adapter-feishu-lark/src** — sidecar 重建陷阱(本 feat 撞 3 次手动删 sidecar)
  - Proxy-aware fetch dispatcher(Layer 2,有/无 VPN 都好用)— `feishu-network-proxy-policy`
  - confirm-card 方案 D 白名单扩展(`~/Documents` 等外部目录)— `feishu-attach-confirm-card`
