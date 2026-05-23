# Bootstrap Mock 蓝图 — W3 整周专精用

> **来源**:`feat/e2e-phase1-mock-mode` W2 D9 调研产物(2026-05-23)
> **作用**:W3 实施 D12-D14 示范用例前,提供"让 UI 走通业务路径"所需的全部 mock 蓝图
> **关键观察**:`bootstrapGlobal` 必须 4 个 query 全部成功,UI 才会进入"已就绪"状态;任一 fail 导致 `ready: false`,UI 卡 loading / 空状态

---

## 一、bootstrapGlobal 必装 4 个 mock(必须全过)

依赖文件:`packages/app/src/context/global-sync/bootstrap.ts:bootstrapGlobal`

| # | SDK 调用 | URL | Response shape | mock 优先级 |
|---|---|---|---|---|
| 1 | `sdk.global.config.get()` | `GET /global/config` | `Config` 对象(看 types.gen.ts) | **必须** |
| 2 | `sdk.provider.list()` | `GET /provider` | `ProviderListResponse` 对象(含 `providers: []` 等) | **必须** |
| 3 | `sdk.path.get()` | `GET /path` | `Path` 对象(home / config / state / cache 路径) | **必须** |
| 4 | `sdk.project.list()` | `GET /project` | `Project[]`(已在 fixtures.ts mockProject 实现) | **必须** |

所有 4 个 query 都返**有效 shape**(SDK gen client 用 `x.data!` non-null assertion,返 null/undefined 会 throw)。

---

## 二、SSE event stream(`/global/event`)

依赖文件:`packages/app/src/context/global-sdk.tsx:start`

- 真后端推送 `Event` 类型流(`session.status` / `lsp.updated` / `message.part.updated` / `sync` 等)
- e2e mock 至少返**空 EventSource stream**(不能 hang,否则前端 reactive 链等)
- 当前 fixtures.ts catch-all 返 200 + JSON,但 SDK 用 SSE 解析,**可能 hang**
- W3 D9 摸 SSE mock 方案:返 `data: \n\n` 空 event,或者 `Content-Type: text/event-stream` 短帧

---

## 三、进入项目工作区 — 触发条件

bootstrap 完后,user 点 "Open project" → 触发以下:

1. `dialog.tauri` → invoke `open` Tauri dialog → 返路径(需 Tauri invoke mock)
2. `globalSync.project.add(path)` → 内部走 SDK / 缓存
3. `loadProjectsQuery` re-fetch → 更新 `GlobalStore.project`
4. UI 切到 "项目已打开" 视图

W3 替代方案:**直接 mock GlobalStore.project 初始就有项目**(已 mocked)+ 自动选第一个项目展示。看 layout.tsx 是否自动展示第一个项目,或要 user 显式选。

---

## 四、文件树 + 文件预览 — 第二层 mock

打开项目后,前端 fetch 文件树 / 文件内容:

| SDK 调用 | URL | mock 实现 |
|---|---|---|
| `sdk.file.list({ path })` | `GET /file?path=...` | 已在 fixtures.ts mockFileTree(返 memfs.list) |
| `sdk.file.read({ path })` | `GET /file/content?path=...` | 已在 fixtures.ts preloadFile(返 `{ type, content }`) |
| `sdk.file.officePdf(...)` | `GET /file/office-pdf` | W3 按需补 |
| `sdk.find.files({ query })` | `GET /find/file?query=...` | W3 按需补(若示范用例触发搜索) |

文件操作 invoke(已在 W1 D5/D6 mock):
- `write_text_file` / `get_file_mtime` / `get_file_size` ✅
- `read_binary_file_base64` / `write_binary_file_absolute_base64` ✅
- `rename_path` / `copy_path` / `trash_path` / `create_*` ✅

---

## 五、Session / Chat — 第三层 mock(D12 auto-save 需要)

打开 session(chat panel)需要:

| SDK 调用 | URL | shape 复杂度 | W3 实施量 |
|---|---|---|---|
| `sdk.session.list()` | `GET /session` | `Session[]` 简单 | 半天 |
| `sdk.session.get({ sessionID })` | `GET /session/{id}` | `Session` 对象 | 半天 |
| `sdk.session.messages({ sessionID })` | `GET /session/{id}/message` | `Message[]`(含 Part 联合 type) | **1-2 天** |
| `sdk.session.diff({ sessionID })` | `GET /session/{id}/diff` | `SnapshotFileDiff[]` | 半天 |
| `sdk.session.todo({ sessionID })` | `GET /session/{id}/todo` | `Todo[]` | 半天 |
| `sdk.session.update / abort / revert / unrevert` | various POST | 简单 | 半天合计 |

session.messages 是最复杂 — Message 含 Part 联合 type(text / tool_call / tool_result / file 等),需要 fixture builder helper:`buildSessionWithMessage(text, ...parts)`。

---

## 六、推荐 W3 实施顺序

| Day | 任务 | 验收 |
|---|---|---|
| W3 D15 | mock §一 4 个 bootstrap query 全过 + SSE 空 stream | UI 进入"已就绪"状态(`ready: true`),不再卡空 |
| W3 D16 | 触发"打开项目"流程(直接 mock `GlobalStore.project[0]` 自动展示) | 看到文件树 + 工作区 layout |
| W3 D17 | D14 large-file-preview spec(最浅,Tauri 已 mock get_file_size) | 1 个 spec 全绿 |
| W3 D18 | D13 chat-drop spec(DOM event,无需 session) | 1 个 spec 全绿 |
| W3 D19 | D12 auto-save spec(最深,要 session + messages stream) | 1 个 spec 全绿;若超时,挂账下周 |
| W3 buffer | CI 接入 + 治理升级延后到 W4 | — |

---

## 七、风险

- **SSE mock 卡 reactive 链**:如果 SSE 不正确 mock,前端可能持续重连导致 e2e 慢 / flaky → W3 D15 必须确认 SSE 不 hang
- **Message part 联合 type 复杂**:auto-save 示范用例需要 session context,Message[] mock 工作量可能爆涨 → 备选:auto-save spec 用 page.evaluate 直接调 store API 绕过 chat panel render
- **bootstrap fail-fast**:任一 query fail,bootstrap 不完成 → W3 D15 必须把 4 个 query response shape 全部对齐(可能要先跑真 sidecar 抓 sample)
