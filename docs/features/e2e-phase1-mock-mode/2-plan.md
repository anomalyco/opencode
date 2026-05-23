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

## 关联文档

| 文档 | 关系 |
|---|---|
| [`1-spec.md`](./1-spec.md) | 本 feat 需求 + 验收 + 架构 |
| [`OPENCODE-PLAN/需求池/自动化测试-完整方案.md`](../../../../OPENCODE-PLAN/需求池/自动化测试-完整方案.md) | 上位方案,本 plan 是其落地切分 |
| [`packages/app/e2e/README.md`](../../../packages/app/e2e/README.md) | 现有 e2e 设施现状(W1 D1 调研基础) |
| [`packages/app/e2e-tauri/README.md`](../../../packages/app/e2e-tauri/README.md) | Phase 2 真桌面,本 feat 不动 |
