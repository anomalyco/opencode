# e2e/mocks — Mock 出口清单(W1 D1 调研产物)

> **来源**:`feat/e2e-phase1-mock-mode` W1 D1(2026-05-23)grep 盘点 `packages/app/src` 全量
> **作用**:Phase 1 Mock e2e 需要拦截 / 模拟的所有"前端→后端"出口,逐项实现进度跟踪表
> **更新策略**:W1-W3 期间每加一个 mock 在表中标 ✅ + impl 文件路径

---

## 一、Tauri invoke 命令清单(`@tauri-apps/api/core` invoke)

来源:`import { invoke } from "@tauri-apps/api/core"` 共 8 个文件,~20 个不同命令调用。

| # | 命令 | 用处 | 主要调用点 | 优先级 | impl |
|---|---|---|---|---|---|
| 1 | `get_file_size` | 大文件防护 pre-check | `context/file.tsx:207` | W1 | ✅ tauri.ts |
| 2 | `get_file_mtime` | mtime 冲突检测 | `pages/session/file-tabs.tsx:445,489,1300` | W1 | ✅ tauri.ts |
| 3 | `write_text_file` | 文本写盘(带 expectedMtime)| `pages/session/file-tabs.tsx:461` | W1 | ✅ tauri.ts |
| 4 | `read_binary_file_base64` | 二进制读 base64 | `utils/md-export-docx.ts:1027` | W1 D5/D6 | ✅ tauri.ts |
| 5 | `write_binary_file_absolute_base64` | 二进制写绝对路径 base64 | `components/file-tree.tsx:818`, `utils/markdown-editor-extensions.ts:342`, `utils/md-export-docx.ts:1722` | W1 D5/D6 | ✅ tauri.ts |
| 6 | `fetch_url_base64` | 远程资源 fetch | `utils/md-export-docx.ts:1665` | W1 D5/D6 | ✅ tauri.ts |
| 7 | `open_path` | 外部 app 打开文件/目录 | `components/file-too-large.tsx:47,55`, `pages/session/file-tabs.tsx:1383,1531` | W1 D5/D6 | ✅ tauri.ts |
| 8 | `reveal_in_folder` | 资源管理器定位 | `components/file-tree.tsx:954` | W1 D5/D6 | ✅ tauri.ts |
| 9 | `rename_path` | 文件/目录重命名(含撤销)| `components/file-tree.tsx:430,514,707,770` | W1 D5/D6 | ✅ tauri.ts |
| 10 | `copy_path` | 复制 | `components/file-tree.tsx:433` | W1 D5/D6 | ✅ tauri.ts |
| 11 | `trash_path` | 移到回收站 | `components/file-tree.tsx:538,924` | W1 D5/D6 | ✅ tauri.ts |
| 12 | `create_empty_file` | 新建空文件 | `components/file-tree.tsx:666` | W1 D5/D6 | ✅ tauri.ts |
| 13 | `create_directory` | 新建目录 | `components/file-tree.tsx:683` | W1 D5/D6 | ✅ tauri.ts |
| 14 | `next_available_path` | 防冲突生成不重名路径 | `utils/file-conflict.ts:24` | W1 D5/D6 | ✅ tauri.ts |
| 15 | `feishu_adapter_status` | 飞书 adapter 状态 | `utils/feishu-config.ts:44` | W1 D6 | ✅ tauri.ts(stub)|
| 16 | `feishu_oauth_start` | 飞书 OAuth 起 device flow | `utils/feishu-config.ts:49` | W1 D6 | ✅ tauri.ts(stub)|
| 17 | `feishu_oauth_poll` | 飞书 OAuth 轮询 | `utils/feishu-config.ts:56` | W1 D6 | ✅ tauri.ts(stub)|
| 18 | `feishu_save_account` | 飞书账户保存 | `utils/feishu-config.ts:101` | W1 D6 | ✅ tauri.ts(stub)|
| 19 | `feishu_list_accounts` | 飞书账户列表 | `utils/feishu-config.ts:108` | W1 D6 | ✅ tauri.ts(stub)|
| 20 | `feishu_delete_account` | 飞书账户删除 | `utils/feishu-config.ts:113` | W1 D6 | ✅ tauri.ts(stub)|
| 21 | `feishu_update_account_model` | 飞书账户改模型 | `utils/feishu-config.ts:123` | W1 D6 | ✅ tauri.ts(stub)|
| 22 | `feishu_list_providers` | 飞书 providers 列出 | `utils/feishu-config.ts:131` | W1 D6 | ✅ tauri.ts(stub)|

**注**:`W2-stub` 表示返一个最简化值即可(不深 mock 业务逻辑),Phase 1 e2e 范围不覆盖飞书桥接(参 1-spec.md §3.1 表注)。

### Tauri invoke mock 路径(预设)

`packages/app/e2e/mocks/tauri.ts` — 接管 `@tauri-apps/api/core` 的 `invoke` export(Vite alias / virtual module),按命令名 dispatch 到内存 fs 或返 stub。

---

## 二、SDK client 调用清单(`@opencode-ai/sdk/v2/client`)

来源:`import ... from "@opencode-ai/sdk/v2"` 或 `"@opencode-ai/sdk/v2/client"` 共 ~25 个文件。

SDK client 通过 `sdk.client.*` / `globalSDK.client.*` 调用,主要 namespace:

| Namespace | 方法 | 调用点(主要)| 优先级 |
|---|---|---|---|
| **file** | `list({ path })` | `context/file.tsx:85` | W2 |
| **file** | `read({ path })` | `context/file.tsx:229` | W2 |
| **file** | `officePdf(...)` | `pages/session/file-tabs.tsx:1544` | W2 |
| **find** | `files({ query, dirs })` | `context/file.tsx:250` | W2 |
| **session** | `list(query)` | `context/global-sync.tsx:241`, `sync.tsx:591` | W2 |
| **session** | `get({ sessionID })` | `context/sync.tsx:471` | W2 |
| **session** | `messages({ sessionID, limit, before })` | `context/sync.tsx:301`, `pages/layout.tsx:785` | W2 |
| **session** | `diff({ sessionID })` | `context/sync.tsx:511` | W2 |
| **session** | `todo({ sessionID })` | `context/sync.tsx:537` | W2 |
| **session** | `update({ sessionID, ... })` | `context/sync.tsx:604`, `pages/layout.tsx:1009`, `message-timeline.tsx:405` | W2 |
| **session** | `abort({ sessionID })` | `pages/session.tsx:1621`, `use-session-commands.tsx:294` | W2 |
| **session** | `revert(...)` | `pages/session.tsx:1633,1666,1668`, `use-session-commands.tsx:301,328` | W2 |
| **session** | `unrevert({ sessionID })` | `pages/session.tsx:1666`, `use-session-commands.tsx:321` | W2 |
| **session** | `share / unshare({ sessionID, directory })` | `message-timeline.tsx:390,397` | W2 |
| **session** | `summarize(...)` | `use-session-commands.tsx:346` | W2 |
| **session** | `command(...)` | `components/prompt-input/submit.ts:84` | W2 |
| **session** | `promptAsync(...)` | `components/prompt-input/submit.ts:155` | W2 |
| **provider** | `auth()` | `components/dialog-connect-provider.tsx:70` | W2-stub |
| **provider** | `oauth.*` | `dialog-connect-provider.tsx:174,595,648` | W2-stub |

### Event 订阅(SSE / 长连接)

未在 grep 中直接发现 `EventSource` 显式调用 — SDK 内部封装。**W1 D2 vite plugin 设计时**确认 SDK event API(可能是 `client.event.subscribe()` 或 `useEvents()` hook),纳入 mock。

### SDK mock 路径(预设)

`packages/app/e2e/mocks/sdk.ts` — 暴露 mock `OpencodeClient`,所有 namespace 方法返内存数据;Playwright `page.route` 在网络层拦 SDK HTTP 调用作为兜底(Stage ② 已用此思路,本 feat 复用)。

---

## 三、内存 fs 接口(W1 D4)

为了让 Tauri invoke + SDK file 两套 mock 共享一个"磁盘状态",定义内存 fs:

```ts
interface MemFS {
  // 读写
  read(path: string): { content: string | Uint8Array; mtime: number; size: number } | null
  write(path: string, content: string | Uint8Array): number  // 返新 mtime
  delete(path: string): boolean
  exists(path: string): boolean
  list(dir: string): Array<{ name: string; isDir: boolean; size: number; mtime: number }>

  // mtime / size 查询
  getMtime(path: string): number | null
  getSize(path: string): number | null

  // watcher
  on(event: "file.edited" | "file.watcher.updated", handler: (e: WatcherEvent) => void): () => void
  emit(event: WatcherEvent): void

  // 测试辅助
  reset(): void
  preload(files: Record<string, string>): void
}
```

实际 impl 在 `packages/app/e2e/mocks/memfs.ts`。

---

## 四、跨 mock contract test 起手(W3)

每周 1 次跑 Phase 2 真 Tauri(`feat/e2e-real-tauri-webdriver` 上)同一个 case,assert 行为一致;漂移立即同步 mock。

**首批 contract 项**:
- `write_text_file` + `get_file_mtime`:写后 mtime 严格自增,与真 sidecar 一致
- `read` SDK file:返回 type discriminator(`type: "text" | "binary"`)对照真 SDK type definitions
- Watcher event:emit `file.edited` shape `{ path, oldMtime, newMtime, source }` 对照真 sidecar 推送

具体落地见 W3 task。

---

## 修订记录

- **2026-05-23 W1 D1**:首版盘点。Tauri invoke 22 命令、SDK 4 namespace ~18 方法。下一步 W1 D2 设计 Vite mock mode 入口。
- **2026-05-23 W1 D2**:`vite/e2e-mock.js` plugin 落地,alias `@tauri-apps/api/core` → `e2e/mocks/tauri.ts`(最简 stub)。npm script `dev:e2e-mock`。
- **2026-05-23 W1 D3**:critical path 验证过 — `bun run dev:e2e-mock` + `bun run test:e2e` → 5/6 pass + 0 console error,UI hydrate 成功。**不触发 D6 fallback**。
- **2026-05-23 W1 D4-D6 合并**:`e2e/mocks/memfs.ts` 完整 + `tauri.ts` 重构为 dispatch 表 + 22 个 invoke 命令全接(fs 11 / 外部 app 3 / 飞书 8 stub)。重构后 spec 仍 5/6 pass(9.1s),verify 无回归。
