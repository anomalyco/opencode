---
feat-id: feishu-attach-upload-robustness
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-attach-upload-robustness — 1-spec(需求 + 验收)

## 背景

2026-05-24 user 实测 ATTACH 文件上传**100% 失败**(`notes.md` 4.7KB 小文件也挂)。日志显示 `socket connection closed unexpectedly`,**关 Clash 代理后依然失败** — 排除代理嫌疑。

**深查根因**(`file-uploader.ts:32, 60`):
```ts
client.im.v1.file.create({ data: { file: createReadStream(path), ... } })
```
飞书 SDK 接受 Node Readable stream,通过 Bun runtime 的 fetch 做 multipart 上传。**Bun fetch 跟 Node createReadStream 在 multipart 编码场景下有兼容性问题**(known Bun runtime 跨 Node 库互操作模式),即使小文件也 socket 断。

辅助问题:无 retry / 无 timeout,瞬时网络抖一下就用户层看到 warning,体验差。

## 用户视角(交付物)

**user 操作**:在飞书私聊或群里说"把 X 文件发给我"(X 必须在 `~/.opencode/feishu-workspace/`)→ bot **稳定收到文件**,**不再撞 socket disconnect**。

如果真有瞬时网络抖动 → pipeline **自动 retry 2 次**,user 大概率感知不到失败。

如果 retry 3 次仍败(罕见) → bot 在飞书 reply 尾巴 append warning(既有行为,user 知道发生了什么)。

## 验收标准

### 功能
1. ✅ `uploadImage()` 把 `createReadStream(path)` 改成 `readFileSync(path)` Buffer(绕 Bun stream multipart 兼容)
2. ✅ `uploadFile()` 同样改 Buffer
3. ✅ 新加 `retryUpload<T>(fn, label)` helper 包 retry 逻辑:
   - 最多 3 次尝试(初次 + 2 次重试)
   - 指数退避 `+1s` `+3s`
   - 仅对**可恢复错误**重试:`socket / network / timeout / 5xx / ECONNRESET`
   - 对**业务错误**(4xx / file_type 不支持 / size 超限)不重试(直接失败)
4. ✅ uploadImage / uploadFile 用 retryUpload 包裹
5. ✅ 上传超时**30s 显式**(`AbortController` + setTimeout)— 防止永久卡住

### 数据 / 不回归
6. ✅ size 限制行为不变(image ≤10MB / file ≤30MB,超限**不重试**直接抛)
7. ✅ 返回的 image_key / file_key 跟之前一样(下游 sendImageMessage / sendFileMessage 不变)
8. ✅ ATTACH marker 协议不变(reply-actions 不动)
9. ✅ 上传成功 case 不增加延迟(retry 仅在失败时触发)

### 安全
10. ✅ `readFileSync` 内存使用上限 = file size,30MB 文件占 30MB 内存(短时)— 可接受(VM 内存远超 30MB,且 sidecar 是 long-running 不释放也没事)
11. ✅ retry 不绕开路径白名单(白名单在 pipeline.processAttachments 上层,与 retry 无关)

### 测试 / 治理
12. ✅ R5 Medium ≥ 3 unit:retryUpload helper extract 模式独立测 + uploadImage/uploadFile 行为测 + size 超限不重试测
13. ✅ `bun run typecheck` 16/16 全过
14. ✅ 三文档全套 + INDEX + 改动日志 entry

## 非目标(Out of scope)

- ❌ Proxy-aware fetch dispatcher(Layer 2,留下个 feat `feishu-network-proxy-policy`)
- ❌ Confirm-card 方案 D 白名单扩展(留下个 feat `feishu-attach-confirm-card`)
- ❌ 换 SDK 版本 / 换 runtime(本笔不动 Bun / SDK 版本)
- ❌ 大文件 (>30MB) 上传支持(飞书 SDK 限制本身)
- ❌ 并发上传优化(罕见场景)
- ❌ Win 端实测(本笔仅 Mac 端开发 + 实测,Win 端等下次双端协作)

## 安全 / 边界

- **Buffer 内存代价**:30MB 文件读到内存占 30MB,短时持有,Node GC 后释放。VM 内存常态有几百 MB → 完全 OK
- **retry 触发条件保守**:误把业务错误 retry 浪费 user 时间。**白名单**:仅 socket / timeout / 5xx / `ECONNRESET` / `EPIPE` 类错误重试,其他直接失败
- **超时 30s**:对 30MB 文件 + 慢网络也够(理论 30MB / 1MB/s = 30s)。同时 user 不至于等太久没反馈
- **失败兜底**:retry 3 次仍败 → 老的 pipeline.processAttachments 把 `⚠️ 发送失败: <reason>` append 到 reply。User 知道情况

## 决策轨迹

- **走法**:user 2026-05-24 拍板 P0 三件套(Buffer + retry + timeout)合一 feat(同主题 "ATTACH 上传可靠性")
- **不动 stream API**:`createReadStream` → `readFileSync` 是显式权衡 — 文件大小本来就有 30MB 上限,内存代价可接受;换来 Bun fetch 兼容性 + 简化(Buffer 比 stream 更稳)
- **retry 次数 3** vs 5:3 已覆盖瞬时抖动 + 短暂服务端 5xx;5 浪费 user 时间
- **重试退避 1s/3s**(非更激进 0.5/1.5):平衡 — 1s 足够让网络恢复,3s 给服务端缓冲
- **超时 30s**:对 30MB 上限 + 1MB/s 慢速估算 + 一定缓冲

## 关联

- 上游:`feishu-bridge-light`(2026-05-23,ATTACH marker 协议 + uploadImage/uploadFile 原始实现)
- 失败实测 trace:`~/Library/Logs/ai.deskfox.app.dev/opencode-desktop_2026-05-24_16-03-02.log`(socket disconnect 多次复现)
- 触动文件:`packages/adapter-feishu-lark/src/feishu/file-uploader.ts`(核心)+ 测试
- 不动:`reply-actions.ts`(ATTACH marker 解析 / 白名单不变)+ `message-pipeline.ts`(processAttachments 不变 — retry/timeout 在 file-uploader 内部封装)
