---
feat-id: feishu-attach-upload-robustness
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-attach-upload-robustness — 3-changelog

> **状态**:✅ 代码落地(2026-05-24,等用户实测)
> **commit 链**:2 commits(spec/plan + 主实施 + 27 单测)
> **规模**:Medium-(~200 行代码 + ~250 行测试,纯 fork-only,0 上游侵入)

## commit 链

| hash | 内容 |
|---|---|
| `983f54646` | docs: 1-spec + 2-plan |
| `645bf2a31` | feat: file-uploader stream→Buffer + retryUpload + withTimeout + 27 单测 |

## 改动文件

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/file-uploader.ts` | +120 | createReadStream→readFileSync Buffer + retryUpload helper + withTimeout helper + isRecoverableError helper + 详细 FORK 注释 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/file-uploader.test.ts` | +260 | 27 新单测(helper extract 12+3+6 + 集成 4+2)+ 既有 SDK 抛错测试改用 non-recoverable error |
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` | +3 | 既有"上传抛错"测试改用 401 而非 502,避免 retry 拖慢 |

## 关键设计点

### 1. stream → Buffer 取舍
**为什么**:Bun runtime fetch 跟 Node `createReadStream` 多部分编码 100% 不兼容(实测 4.7KB 都断),原因可能在 Bun fetch internal stream handling 跟 Node Readable stream 互操作。**Buffer 直传简单可靠**,SDK 内部转 multipart 不依赖 stream pipe,绕开兼容性问题。

**内存代价**:30MB 上限 ≪ Bun VM 默认 4GB,short-lived 无 OOM 风险。read+upload+gc 单次循环很快。

**实测 user 4.7KB notes.md 改 Buffer 后期待成功**(留实测验证)。

### 2. retry 模式(helper extract,3 次尝试,指数退避)
- 初次 + 2 retry = 3 总尝试
- 退避 1s/3s(prod 默认),给网络/服务端缓冲时间
- options.delaysMs 可覆盖让测试用 10ms 快退避

### 3. 可恢复错误白名单(保守)
仅以下 patterns 触发 retry,业务错误立即失败:
- `socket.*closed` — 飞书 SDK 报的"The socket connection was closed unexpectedly"
- `econnreset` / `epipe` — Node 网络层
- `network.*error` / `timeout` — 通用网络
- `\b5\d{2}\b` — 5xx HTTP status

**不重试**:4xx / 401 / size 超限 / file_type 不支持 / 其他业务错误。

### 4. 显式 timeout(Promise.race 实现)
- 30s 默认(对 30MB 上限 + 1MB/s 慢速估算 + 缓冲)
- Lark SDK 不接 AbortSignal,只能软超时(后端请求 Promise reject 但实际请求可能仍跑,GC 处理)
- timeout 抛错触发 retry(timeout 在 RECOVERABLE_ERROR_PATTERNS 内)

### 5. helper extract 模式(R5 v2 双清单)
3 个 helper 全部 `export`(`isRecoverableError` / `withTimeout` / `retryUpload`),纯函数独立可单测,跟 SDK IO 解耦:
- isRecoverableError:input Error → boolean(行覆盖 100%)
- withTimeout:input Promise + ms → Promise(行覆盖 100%)
- retryUpload:input fn + label + opts → Promise(行覆盖 100%)

## 测试

### 27 个新测试(R5 Medium ≥ 3 unit 远超达标)

**isRecoverableError (12 case)**:覆盖所有 RECOVERABLE_ERROR_PATTERNS 命中 + 业务错误不命中 + 空 / undefined 防御

**withTimeout (3 case)**:resolve before timeout / 超 timeout / 透传错误

**retryUpload (6 case)**:成功一次 / 1 错+成功 / 2 错+成功 / 3 错 throw / 非可恢复立即 throw / timeout 触发重试

**uploadImage retry 集成 (4 case)**:1 错+成功 / 3 错 throw / size 超限 0 调 / 非可恢复立即失败

**uploadFile retry 集成 (2 case)**:1 错+成功 / 3 错 throw

### 全套套件
- 512/512 全 adapter 套件全过(原 485 + 新 27)
- 16/16 bun run typecheck monorepo 全过

### 既有测试更新(2 处)
- `file-uploader.test.ts` "SDK 抛 → 透传":错误从 `lark 502`(可恢复)改 `401 Unauthorized`(不可恢复)避免 retry 触发拖慢
- `message-pipeline.test.ts` "上传抛错 → 不阻断":同样改 401

### 实测脚本(2026-05-24,user 验收)

build dev .app 装 `/Applications/DeskFox Dev.app` 后:

1. **场景 1 — 灵狐 (MiniMax) 发 notes.md**:私聊里说"workspace 里有个 md 文件传给我吧"
   - **预期**:bot reply "好,发给你 [ATTACH:...]" → 系统真上传成功 → 飞书收到文件
   - 日志层面:`[file-uploader] image notes.md 重试第 X 次成功` 或一次通过无 retry log

2. **场景 2 — 测试 retry 自愈**:网络抖动(可关 wifi 1s 再开,模拟瞬时断)
   - **预期**:bot 日志 `第 1 次失败,1000ms 后重试` 然后 `重试第 1 次成功`,user 看不到 warning

3. **场景 3 — 测试 timeout**:模拟难,可暂不测

4. **场景 4 — 测试不重试 size 超限**:让 bot 发 > 10MB 图片
   - **预期**:立即抛 size 错误 warning(不浪费 3 次重试)

## 三铁律走流程

| 步骤 | 状态 |
|---|---|
| 开 feat 分支 `feat/feishu-attach-upload-robustness` | ✅ |
| 本地 commit 不动 main | ✅ |
| → main merge user 同意 | (待 user 拍)|
| → origin/main push user 同意 | (待 user 拍)|

## 风险 / 已知限制

1. **Bun fetch 兼容性是不是真原因不能 100% 确认**:Buffer 修法是基于假设;如果 user 实测 Buffer 也挂,说明 root cause 在更深层(SDK 内部 / 网络栈 / 飞书 server),需 Layer 2(自实现 fetch + form-data)
2. **30MB 文件占 30MB 内存**:短时,VM 4GB 远超,但极端并发上传 N 个大文件可能 spike — 当前飞书桥接架构是顺序处理,无并发风险
3. **timeout 30s 对真慢网络可能不够**:30MB / 100KB/s = 300s 才能传完;30s 超时会触发 retry 但 3 次都超时 → 总耗 90s 后失败(user 看到 warning)— 现实合理
4. **Lark SDK 内部不支持 AbortSignal**:Promise reject 后请求可能仍在后台跑(无害)— SDK 限制接受
5. **跨平台**:Win 端未测;Bun + Lark SDK 在 Win 应该同样行为(Bun runtime 跨平台),但实际是否如此等下次双端协作再验

## 回退方法

`git revert -m 1 <merge-commit-hash>` 直接退回。或手动:
- `file-uploader.ts` 改回 `createReadStream` + 删 retry helper
- 删测试新增段
- 旧 lark 502 测试改回

## 关联

- 上游 ATTACH 实现:`feishu-bridge-light`(2026-05-23,marker 协议 + 原始 uploadImage/uploadFile)
- 失败实测 trace:`opencode-desktop_2026-05-24_16-03-02.log`(socket disconnect 4 次以上复现)
- 触动文件:`packages/adapter-feishu-lark/src/feishu/file-uploader.ts`(核心)
- 不动:`reply-actions.ts`(marker 解析 / 白名单)+ `message-pipeline.ts` 主逻辑(retry 内部封装,pipeline 透明)
- 留 backlog:Proxy-aware fetch dispatcher(Layer 2,有/无代理 user 都好用)— 单独 feat `feishu-network-proxy-policy`
- 留 backlog:confirm-card 方案 D 白名单扩展(`~/Documents` 等外部目录)— 单独 feat `feishu-attach-confirm-card`
