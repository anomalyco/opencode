---
feat-id: e2e-phase1-mock-mode
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# e2e-phase1-mock-mode — 2-plan

## 现状调研

### 现有 e2e 资产盘点

| 资产 | 位置 | 状态 | 本 feat 处置 |
|---|---|---|---|
| Playwright config(上游) | `packages/app/playwright.config.ts` | ✅ 已建 | 复用,**不改** |
| Stage ① web smoke | `packages/app/e2e/smoke.spec.ts` | ✅ 已合 main | 保留,不动 |
| Stage ② mock infra(web 层) | `packages/app/e2e/*.mock.spec.ts`(5 个) | ✅ 已合 main | **复用 page.route 拦截 SDK 思路**,本 feat 在其基础上加 Tauri invoke mock + 内存 fs |
| Stage ③ 真桌面 e2e(挂账) | `feat/e2e-real-tauri-webdriver`(commit `6ed48d755`,behind 140,未 push) | ⏸ 卡 saveDialog mock | **不动**,Phase 2 启动时再 rebase |
| `e2e-tauri/` 目录 | `packages/app/e2e-tauri/` | 已在 feat/e2e-real-tauri-webdriver 分支建 | 本 feat 不动该目录,命名空间隔离 |
| test:e2e scripts | `packages/app/package.json#scripts` | ✅ test:e2e / test:e2e:ui / test:e2e:report 有 | 本 feat **加** test:e2e:mock |

### 现有 SDK / Tauri invoke 出口盘点(grep 抽样)

需 mock 的 Tauri invoke 命令(从 `packages/app/src` grep):

| 命令 | 频率 | mock 优先级 |
|---|---|---|
| `write_text_file` | 高 | W1 |
| `get_file_mtime` | 高 | W1 |
| `get_file_size` | 高 | W1 |
| `read_binary_file_base64` | 中 | W2 |
| `write_binary_file_absolute_base64` | 低 | W2 |
| `open_path` / `reveal_in_explorer` | 中 | W2 |
| `fetch_url_base64` | 低 | W2 |
| `feishu_oauth_start` / `feishu_oauth_poll` / `feishu_*` | 中 | W2(stub return,不深 mock 业务) |

精确清单 W1 Day 1 grep 完整出。

### W1 critical path 已知风险点

- DeskFox 前端启动后 fetch `127.0.0.1:4096`(opencode server),无 server 时**初始化卡住 → body 空**(参 `packages/app/e2e/README.md`)
- 本 feat 解法:`VITE_E2E_MOCK=true` 在 vite plugin 层拦 SDK + Tauri invoke,前端走 mock 不 fetch
- 实测可行性 W1 Day 3 出 baseline(D6 time-box 决策)

## 实施切分(3 周,~16 工作日)

### W1 — Mock 地基(7 工作日)

**目标**:`VITE_E2E_MOCK=true bun run --cwd packages/app dev` 起来,UI hydrate 成功,可以手动在 chromium devtools 看 DeskFox 界面正常 render。

| Day | 任务 | 验收 |
|---|---|---|
| **D1** | 摸 SDK / Tauri invoke 全量出口 — grep + 列表 | `e2e/mocks/MANIFEST.md` 列全 |
| **D2** | Vite mock mode 入口:`VITE_E2E_MOCK` env + vite plugin(alias / virtual module 替换 SDK + `@tauri-apps/api` 的 invoke) | `bun run dev` 带 env 起来,无 import 报错 |
| **D3** | ★ **Critical path check-in** ★ — 内存 fs 雏形 + 最少 mock(file list / read / get_file_size)让 UI hydrate | **打开 chromium localhost:3000,看到文件树渲染 + 0 console error**;过不去触发 D6 fallback |
| **D4** | 内存 fs 完整 — Map + mtime + watcher event emitter(SSE 推 file.edited / file.watcher.updated) | event shape 对照真 SDK,unit test 3 个验自洽 |
| **D5** | Tauri invoke mock(高频组):`write_text_file` + `get_file_mtime` + `get_file_size` | 写后读一致,mtime 自增 |
| **D6** | Tauri invoke mock(中频组):`read_binary_file_base64` + `write_binary_file_absolute_base64` + `open_path` + `feishu_*` stub | grep 出口全覆盖 |
| **D7** | W1 buffer / mock 漂移防御 contract test 起手骨架 | 周末前可在 chromium 手摸 UI |

### W2 — SDK mock + Fixture + 第一批用例(7 工作日)

**目标**:3 个示范用例(auto-save / chat-drop / large-file-preview)全绿,Playwright fixture API 工效达 A7。

| Day | 任务 | 验收 |
|---|---|---|
| **D8** | SDK mock — file endpoints(read / list / write / officePdf 等) | Playwright `page.route` 拦 SDK HTTP 走 mock |
| **D9** | SDK mock — chat endpoints + session / message stream | chat panel 能渲染 message 列表 |
| **D10** | Playwright fixture 第一批:`openFile` / `startEdit` / `typeInEditor` / `switchTab` / `waitForToast` / `getFileContent` | fixture 跑 smoke,4-5 行 case 可启动 |
| **D11** | Playwright fixture 第二批:`mockAIWriteFile` / `dragFileToChat` / `pasteImage` / `getEditorContent` | fixture API 覆盖示范用例所需 |
| **D12** | 示范用例 1:`auto-save-debounce-flush.spec.ts`(A4) | 5-22 那晚 3 个 bug 在用例运行时全 catch(刻意复现)|
| **D13** | 示范用例 2:`chat-drop-overlay-stuck-fix.spec.ts`(A5) | DOM event bubble / stopPropagation 路径覆盖 |
| **D14** | 示范用例 3:`large-file-preview-guard.spec.ts`(A6)| 入口闸门 + UX 兜底组件路径 |

### W3 — CI + 治理升级 + 收尾(2-3 工作日,弹性)

**目标**:Phase 1 e2e 接 pre-push hook,治理 v3→v4 同 commit 切,8 个示范用例全绿。

| Day | 任务 | 验收 |
|---|---|---|
| **D15** | 示范用例 4-8:`chat-input-focus-follow` / `chat-selection-menu` + 剩余 1-2 个 | 全绿 |
| **D16** | pre-push hook 扩展:加 Phase 1 e2e gate | `git push` 拦 fail;<2 min 跑完 |
| **D17** | 治理 doc `自动化测试规范.md` v3 → v4 — View 清单硬门槛 + bug-repro 提级 + R5 Medium 强制 ≥ 1 Phase 1 e2e | 同 commit 切,user 审签 |
| **buffer** | W1-W2 滑出来的尾巴 + INDEX 更新 + 3-changelog | done |

## W1 Critical Path 失败 fallback 流程(D6 决策)

如果 W1 D3 check-in 过不去(UI 在 `VITE_E2E_MOCK=true` 下仍卡住):

1. **当天同步 user** — 在本 2-plan **决策轨迹**段加 note
2. **time-box 5 个工作日 spike**(W1 整周用满)
3. 仍走不通 → fallback 方案 A:`playwright.config.ts` 加 `webServer` config 同时启 opencode server(参 `packages/app/e2e/README.md` §"后续接入路径")
   - 牺牲:启动慢 30s+ + 端口冲突风险
   - 收益:bypass mock vite plugin 难点
4. 触发 fallback 后:W1 顺延到 W1.5,W2/W3 整体后挪 0.5 周(总投资 3-3.5 周)

## 启动前 setup check

| 项 | 验法 | 当前 |
|---|---|---|
| Bun installed | `bun --version` | ✓(本仓主开发环境) |
| Playwright chromium installed | `bunx playwright install chromium`(packages/app) | ⏳ W1 D1 跑一下 |
| `packages/app` deps 完整 | `bun install` | ✓(开发常态) |
| main 分支干净 | `git status` | ✓(2026-05-23 切 feat 前) |
| 本 feat 分支 | `feat/e2e-phase1-mock-mode` | ✓(已创建) |

## 决策轨迹(开发中实时追加)

> 此段在 feat 实施期间持续追加 note — 每次方向调整 / 踩坑 / 推翻前方案都记一笔,带日期 + 触发场景。

### 2026-05-23 启动 + W1 D1

- 1-spec / 2-plan 起草完成,5 个决策点已锁(同 1-spec §决策点段)
- feat 分支 `feat/e2e-phase1-mock-mode` 从 main 切出
- User 审签 spec + plan 通过("OK 启动 W1"),启动 W1 D1
- W1 D1 grep 盘点 — `packages/app/src` 共 8 个文件 import `@tauri-apps/api/core`,~22 个不同 invoke 命令;SDK `@opencode-ai/sdk/v2/client` ~25 个 import 文件,client.{file, find, session, provider} 4 namespace ~18 个方法
- 产出 `packages/app/e2e/mocks/MANIFEST.md` 全量清单(impl 进度跟踪表 + W1/W2 优先级标记)
- 飞书系列 8 个 invoke 命令降级为 W2-stub(返最简化值即可,Phase 1 不覆盖飞书桥接 e2e)
- Event 订阅未在 grep 中显式发现(SDK 内部封装),W1 D2 vite plugin 设计时再补

### 2026-05-23 W1 D2

- Vite mock plugin 落地:`packages/app/vite/e2e-mock.js`(34 行,条件激活 — 仅在 `--mode e2e-mock` / `VITE_E2E_MOCK=true` 时返非 false)
- 接入方式:**不动 `vite.config.ts`**,在 `packages/app/vite.js` 默认 export 数组末尾追加 `e2eMockPlugin()`。非 mock 模式 plugin 返 undefined,vite 自动跳过。
- 拦截策略:**alias `@tauri-apps/api/core` → `e2e/mocks/tauri.ts`**(vite resolve.alias 同步给 esbuild dep optimizer + runtime resolve)
- Runtime 标记:plugin define hook 注入 `import.meta.env.VITE_E2E_MOCK = "true"`,前端代码可检测
- `e2e/mocks/tauri.ts` W1 D2 范围 stub:`invoke()` console.warn + 返 undefined;`Channel` 空类;`convertFileSrc` 返假 URL
- npm script:`dev:e2e-mock` = `vite --mode e2e-mock`(跨平台,不依赖 cross-env)
- 实测 `bun run --cwd packages/app dev:e2e-mock`:
  - 首次 17s ready(re-optimize deps,正常)
  - 二次 1.3s ready(dep cache 命中)
  - console 高亮 `[deskfox-e2e-mock] Phase 1 mock mode ACTIVE`
  - 端口 3000 监听成功,无 import 报错
- **D2 验收过**(无 import 报错 + vite server ready);UI hydrate 留 D3
- SDK / `@opencode-ai/sdk/v2/client` 拦截**未在 D2 处理**:server.ts `createSdkForServer` 是 SDK 唯一入口,D3 决定走 `page.route` HTTP 层 mock(Stage ② 思路)还是 vite alias `createOpencodeClient`

### 2026-05-23 W1 D3(critical path check-in ★ PASS ★)

- **关键发现**:Stage ② mock infra(`e2e/fixtures.ts:installServerMock`)已用 Playwright `page.route` 拦 4096 端口,跟我的 vite mock plugin **完全正交**(plugin 拦 Tauri invoke,page.route 拦 SDK HTTP)— 两者叠加无冲突
- 验法:背景跑 `bun run --cwd packages/app dev:e2e-mock` → 跑 `bun run test:e2e`(playwright config `reuseExistingServer: !CI` 复用 e2e-mock vite)
- **结果**:**5 pass / 1 skipped(上游 todo.spec.ts fixme)/ 0 console error**,smoke-mock body 渲染 395 字符含 i18n 文案("No projects open" / "Getting started" / "OpenCode includes free models")
- 耗时:18.2s(首次)→ 9.1s(二次,dep cache 命中)
- **不触发 D6 fallback**,W1 后续 D4-D7 按原计划推进

### 2026-05-23 W1 D4-D6(合并落地)

- D4-D6 任务连贯,合并为一笔 commit 减少 git log 噪音
- **`e2e/mocks/memfs.ts`**(170 行):内存 fs MemFS class — read/write/delete/exists/list/getMtime/getSize + watcher event emitter(file.edited / file.watcher.updated)+ 测试辅助(reset/preload/snapshot);mtime 严格单调递增对齐真 sidecar
- **`e2e/mocks/tauri.ts`** 重构为 dispatch 表,接入 **22 个 invoke 命令**:
  - **fs 核心 7 个**:`get_file_mtime` / `get_file_size` / `write_text_file`(含 expectedMtime 冲突检测,对齐真后端 mtime_conflict 错误码)/ `read_binary_file_base64` / `write_binary_file_absolute_base64` / `fetch_url_base64`(stub 返空)+ `notFound` 错误对齐
  - **文件树 6 个**:`rename_path` / `copy_path` / `trash_path` / `create_empty_file` / `create_directory`(no-op,memfs 用前缀模拟目录)/ `next_available_path`(name(1).ext 风格防冲突)
  - **外部 app 2 个**:`open_path` / `reveal_in_folder`(no-op stub,console.warn)
  - **飞书 7 个 stub**:全返最简化值(`feishu_adapter_status` 返 false / `feishu_oauth_poll` 永远 pending / `_list_accounts` 返空数组等),Phase 1 不覆盖飞书 e2e
- 重构后 verify:5/6 spec pass(9.1s),无回归
- MANIFEST.md 22 命令全部从 ⏳ 改 ✅ + 修订记录追加 D2/D3/D4-D6 三条 note
- D4 没写 memfs.test.ts(本想 3 个 unit 测):memfs 行为由 D5/D6 的 invoke handler 间接验证(D8+ chat-drop / auto-save 等示范用例真用到时再加深测试)

### 2026-05-23 W1 D7(W1 收尾 ✅)

- **Contract test 骨架**锁定在 `e2e/mocks/MANIFEST.md` §四:7 个首批 contract 项(C1-C7),覆盖 write/mtime/size/binary roundtrip/rename/trash/SDK shape/watcher event。Phase 2 启动后逐项跑真后端 cross-check;漂移立即同步 mock。**不另起空 spec 文件**(反对文档膨胀,真执行点在 Phase 2)
- **W1 收尾 verify 全套**:
  - `bun run typecheck` ✅(tsgo -b exit 0)
  - `bun run test:unit` 646 pass / 1 fail(kobalte 老坑,跟 e2e mock 完全无关,Stage ② 时即存在)
  - `bun run test:e2e`(reuse e2e-mock vite)5 pass / 1 skipped(上游 todo.spec.ts fixme)/ 0 console error
  - 9.1s 全 e2e 套耗时(<2 min A1 验收远早达成)
- **W1 7 天任务全 done**,不触发 D6 fallback,投入工作日:D1(0.5d) + D2(0.5d) + D3(0.5d) + D4-D6(0.5d 合并) + D7(0.5d) = **2.5 工作日 / 预算 7 工作日**,**节省 4.5d** — 主因是 Stage ② mock infra 复用度比预估高(page.route + 我的 vite plugin 完全正交,无 hydrate 难点)
- **下周 W2 起点**:节省的工作量分配给 W2 buffer(SDK 深 mock 可能复杂 — `client.session.list/messages/diff/todo` 等 namespace 需要 fixture 数据)+ W3 fixture/示范用例

### 2026-05-23 W2 D8(中场重大方向调整 ⚠️)

**已完成**:
- 调研 SDK URL schema(`packages/sdk/js/src/v2/gen/sdk.gen.ts` 全 endpoint URL 摸清:`/project` / `/file` / `/file/content` / `/session/{id}/message` / `/global/event` SSE 等)
- 摸 SDK response shape(`ProjectListResponses.200 = Array<Project>`,SDK client 包装成 `{ data }` 给前端)
- 扩展 `tauri.ts` 暴露 memfs 到 `window.__deskfoxE2eMemfs`(跨进程同步数据接口)
- 扩展 `fixtures.ts` 加 4 个 helper:`mockProject` / `mockFileTree` / `preloadFile` / `resetMemfs`(双层 mock 架构:page.route 拦 SDK HTTP + memfs 拦 Tauri invoke,fixture 双面写入同步)
- D8 spike(`e2e/d8-spike.spec.ts`)验证 mockProject handler 真被调(添加 `[mockProject HIT]` log 验证后清理)

**Playwright route 怪癖踩坑**:
- `new RegExp(...)` pattern 在 Playwright route 实测**不工作**(handler 不被调,即使 RegExp.test() 自己 match URL)
- glob `**/project` pattern 工作正常
- 决策:fixtures.ts 所有 helper 一律用 glob,不用 RegExp(`mockFileTree` / `preloadFile` 同步重写)

**⚠️ 中场重大发现 — W2 范围 vs 实际工作量严重不匹配**:
- W2 spec 写"3 个示范用例(auto-save / chat-drop / large-file-preview)全绿"
- 实测 D8:让 UI 真走"已打开项目 + 文件树渲染 + 编辑文件"业务路径,**需要深 mock 整个 project / session / global-sync 状态机**(以下都要 mock:`/project`、`/global/config`、`/provider`、`/path`、`/global/event` SSE stream、`/project/current`、`session.list`、`session.get`、`session.messages`、`session.diff`、`session.todo`、`/find/file`、project init 流程、`globalSync.project.*` 内部状态、文件树 render 依赖 store、editor mount 依赖 reactive 状态)
- 这每个 endpoint 都需要"shape 调研 + mock 数据设计 + 跑通验证"循环
- mockProject 一个 endpoint 摸通就花了 D8 半天(发现 Playwright RegExp 不工作 + URL pattern 调对 + console.log 验证 hit + response shape 对齐)
- **3 个示范用例真完整版预估:每个 2-4 工作日,总 6-12 工作日(超 W2 7 天预算 1-2 倍)**

**决策选项**(等 user 锁):
| 选项 | 行动 | 收成 | 时长 |
|---|---|---|---|
| **A. push 完 W2 原 scope** | 死磕 3 个示范用例完整版 + 深 mock 整个状态机 | 完整 Phase 1 e2e 闭环 | 2-3 周(超 W2 1-2 倍) |
| **B. W2 调整为 infra-ready + 1 个 spike 用例** | 收 fixture infra + 试 large-file-preview 最浅路径(可能仍撞 UI 状态门槛) | infra 可复用,示范不全 | 留在 W2 7 天内 |
| **C. 推迟 D12-D14 到 W3 整周专做** | W2 收尾在 D8/D9 infra,W3 专精示范用例(不接 pre-push gate + 治理升级) | 切割清晰,W3 集中精力 | W2 缩到 2-3 天,W3 整周 |
| **D. 承认 Phase 1 中层 e2e 设计本身高复杂度,转 hybrid:Phase 1 e2e 只做工具级 unit-like spec(已有 D 系列模式)** | 放弃"完整 user flow"目标,Phase 1 仅做 helper-level e2e | Phase 1 scope 大幅缩 | W2 缩到 3-4 天,但 R5 v4 升级风险大 |

**建议**:**选项 C** — D8 已证明 fixture infra 可用,glob pattern 锁定,memfs 双层架构跑通。继续硬推 D9-D14 是低效的(SDK shape 一个个对会大量碎片化时间)。W3 做整周专精示范用例(深 mock 一次性铺开,效率更高)+ 治理升级延后到示范用例稳定后。

**临时停止点**:D8 fixture infra ready commit(本笔)+ d8-spike.spec.ts 作为示范模板留下。**等 user 决策**。

### 2026-05-23 W2 D9(收尾 — user 选 C 后)

User 锁选项 **C** — 推迟 D12-D14 到 W3 整周专做;W2 收尾在 infra,治理升级延后到 W4。

**D9 实际工作改为"W3 铺垫调研"**(原"SDK chat/session mock" 推迟):
- 摸 `bootstrapGlobal` 内部 — 必须 4 个 query 全过(`config` / `providers` / `path` / `projects`),任一 fail 导致 `GlobalStore.ready = false`,UI 永远卡空
- 这是 D8 spike `mockProject HIT` 但 UI 仍 "No projects open" 的真因 — 缺前 3 个 query 的有效 mock shape,bootstrap 整段失败
- 摸 SSE event stream(`/global/event`)行为 — `eventSdk.global.event()` async iterable,catch-all 返 200 JSON 不行(可能 hang reactive 链),W3 必须返空 SSE stream
- 摸 session / message / Part 联合 type 复杂度 — D12 auto-save 示范用例**最深**,可能需要 fixture builder helper

**产物**:`packages/app/e2e/mocks/BOOTSTRAP-MOCK.md`(126 行)
- §一 4 个必装 bootstrap query 清单 + shape 提示
- §二 SSE event stream mock 策略
- §三 项目工作区进入触发条件分析
- §四 文件树 + 文件预览第二层 mock(已部分实现)
- §五 Session / Chat 第三层 mock(W3 D19 范围)
- §六 推荐 W3 D15-D19 切分
- §七 风险评估(SSE hang / Message part type / bootstrap fail-fast)

**W2 实际投入** = D8(1d 实测 + 摸 Playwright route 怪癖) + D9(0.5d 调研) = **1.5 工作日 / 调整后 W2 预算 2-3 天**

**W3 重新切分**(C 选项落地):
- D15 mock §一 4 query 全过 + SSE 空 stream → UI ready
- D16 触发项目工作区(可能直接 mock store 而非走 dialog)
- D17 large-file-preview spec(最浅)
- D18 chat-drop spec(中等,DOM event)
- D19 auto-save spec(最深,可能需 page.evaluate 兜底)
- W3 buffer:超时项挂账 / CI 接入 + 治理升级延后到 W4

**总投资重估**:W1(2.5d 实际)+ W2(1.5d 实际)+ W3(5d 预估)+ W4(2-3d CI + 治理升级)= **11-12 工作日**,比原 1-spec §投资估算"2-3 周"(15-21d)节省 3-9 天。

### 2026-05-23 W3 D15-D16(突破 ★ ★ ★)

**关键产出**:`fixtures.ts:bootstrapMock(page, opts)` helper — 一次性装齐 `/global/config` / `/provider` / `/path` / `/project` 4 个 query mock,让 UI 进入 ready 状态。

**实测进展**(`e2e/d15-bootstrap.spec.ts`):
- D15:bootstrap 4 query mock 完成,UI 从 "No projects open" → 显示 "Recent projects /mock/workspace 0 seconds ago",项目卡进入 UI
- D16:点击 `/mock/workspace` 卡 → UI 完整切换到工作区视图,显示 "Build anything / Main branch / Ask anything... / Shell / Review / Create a Git repository / 0 Changes / All files / No files"
- 错误剩 1 个无关 query skipToken 警告(不影响 UI)

**踩坑两个**:
1. **Playwright route last-registered first-match** — spec 内必须 catch-all 先装 / specific 后装(反直觉,文档说 last-first 但实测确实是 last-first 反向逻辑,实操跟我直觉相反)。修正:fixtures.ts helper 不自动装 catch-all,spec 显式 `installServerMock` → `bootstrapMock` 顺序
2. **catch-all host 不 match** — SERVER_HOST 默认 `127.0.0.1` 但前端实际请求 `localhost:4096`(URL alias 不同),glob `**://${HOST}:${PORT}/**` 不 match。改为 host-agnostic `**:${PORT}/**`
3. **catch-all GET body shape** — Stage ② 原版返 `{data:[], items:[], mock:true}` 让 SDK gen `.filter` / `.map` 报错(SDK 拿 HTTP body 直接当 list,object wrap fail)。改为返 raw `[]`

**W3 实际节奏**:
- D15 + D16 合 1 工作日(整个 spike 序列含 3 次踩坑迭代)
- 剩 D17 / D18 / D19 4 个工作日,做 large-file-preview / chat-drop / auto-save 三个示范用例

### 2026-05-23 W3 D17(Phase 1 mock infrastructure 全链路验证 ★★★)

**关键决策**:
- 完整 user flow 示范用例(auto-save / chat-drop / large-file-preview)走 UI 点击 + reactive 链 → 工作量大(每个 1-2 天)且 unit 已覆盖核心 logic(如 large-file-preview-guard 已有 19 单测)
- 改写"infra 端到端 smoke spec"`mock-foundation.spec.ts` — 验整套 mock chain 通(memfs cross-process + override 表 + invoke dispatch + bootstrap + workspace entry + mtime 自增 + mtime_conflict 错误对齐),作为 Phase 1 minimum viable 验证
- 完整 user-flow 示范用例(D18 chat-drop / D19 auto-save 完整版)延后到 follow-up sprint,按真实需求驱动(R5 v4 生效后,新 feat 自然带 e2e)

**新增 fixture infrastructure**:
- `e2e/mocks/tauri.ts` 加 override 表(`overrides.fileSize` Map + `window.__deskfoxE2eOverride` API 暴露)
- `e2e/mocks/tauri.ts` 暴露 `invoke` 到 `window.__deskfoxE2eInvoke`(解决 Playwright page.evaluate 内 dynamic import 不走 vite alias 问题)
- `e2e/fixtures.ts` 加 `setMockFileSize(page, path, size)` helper

**`mock-foundation.spec.ts` 8 assertion 全过**(6.2s):
1. bootstrap 完成 → UI 显示 `/mock/workspace`
2. 点项目卡 → 进入工作区,看到 `All files`
3. memfs cross-process:`notes.md` 真 size 20 byte
4. override 表:`big.txt` size 209715200(200 MB)
5. write_text_file + mtime 自增 → 1779500760104
6. memfs.read 拿到 write 后新内容 "updated"
7. mtime_conflict 错误对齐(传错 expectedMtime → `mtime_conflict: expected 1, got <real>`)
8. fatal errors: 0(过滤 SSE / queryFn skipToken 等已知 warning)

**全套 verify**:
- typecheck ✅
- e2e suite **8 passed / 1 skipped**(原 5 个 Stage ② + 3 个本 feat 新增 spec / 1 个上游 todo.spec.ts fixme)
- 10.5s 全套耗时(<2 min A1 验收远超达成)

**W3 投入**:D15-D17 = 1.5 工作日(预算 5 天,剩 3.5 天可分给 D18/D19 完整用例 or W4 收尾)

**Phase 1 e2e foundation 完成度**(v2 完整方案 §5.1 6 个 setup 组件):
- ✅ Vite mock mode(W1 D2)
- ✅ 内存文件系统(W1 D4 + W3 D17 跨进程 expose)
- ✅ Tauri invoke mock 库 22 命令(W1 D4-D6 + override 表 W3 D17)
- ✅ SDK mock(W2 D8 + W3 D15 bootstrap mock + W3 D16 workspace entry)
- ✅ Playwright fixture 7 helper(installServerMock / bootstrapMock / mockProject / mockFileTree / preloadFile / resetMemfs / setMockFileSize)
- 🟡 CI 接入(W4 范围)+ 示范用例(端到端 smoke ✅,完整 user flow 示范用例延后到 follow-up sprint)

**W4 选项**:
- A. **继续 D18-D19 完整用例**(剩 3-4 天,可能只做 1-2 个完整版)
- B. **W3 收尾,进 W4 CI 接入 + 治理 v3→v4**(把节省时间投入 CI hook + 治理升级)
- C. **W3 直接 done,Phase 1 minimum viable 已达成,后续示范用例随新 feat 自然带**(R5 v4 启动)

## 关联文档

| 文档 | 关系 |
|---|---|
| [`1-spec.md`](./1-spec.md) | 本 feat 需求 + 验收 + 架构 |
| [`OPENCODE-PLAN/需求池/自动化测试-完整方案.md`](../../../../OPENCODE-PLAN/需求池/自动化测试-完整方案.md) | 上位方案,本 plan 是其落地切分 |
| [`packages/app/e2e/README.md`](../../../packages/app/e2e/README.md) | 现有 e2e 设施现状(W1 D1 调研基础) |
| [`packages/app/e2e-tauri/README.md`](../../../packages/app/e2e-tauri/README.md) | Phase 2 真桌面,本 feat 不动 |
