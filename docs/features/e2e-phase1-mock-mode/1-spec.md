---
feat-id: e2e-phase1-mock-mode
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# e2e-phase1-mock-mode — 1-spec

> **自动化测试 Phase 1 落地**:Vite mock mode + 内存 fs + Tauri invoke / SDK mock + Playwright fixture,让 Claude 在 chromium 里**自闭环**跑组件级 e2e,关掉"修完丢 user 测"ping-pong 循环

## 需求来源

2026-05-22 立项 `OPENCODE-PLAN/需求池/自动化测试-完整方案.md`(v2),触发点是 2026-05-21/22 跨日 12 笔 feat 落地中反复撞 ping-pong:**Claude 改 → 丢 user 测 → user 报 bug → 再改再丢**。最痛是 `auto-save-debounce-flush` 一晚上 3 round-trip,根因都在 reactive 链(切 tab unmount + onCleanup flush race + store stale)非真 Tauri,**本可早 catch**。

治理 doc `docs/governance/自动化测试规范.md` v2 决策 2 双清单(Logic + View)的 View 清单硬门槛**等 e2e 基础设施 setup 后生效** — 当前 View 清单已挂 2 个文件,硬门槛悬空一年,本 feat 就是去解这个死结。

不走真桌面 e2e(已有 `feat/e2e-real-tauri-webdriver` 挂账,卡 saveDialog mock):**Phase 2 真桌面留待 Phase 1 跑顺 3-6 月后,数据驱动选 critical path**(参 v2 §六 + §十一 决策 4)。

## 目标

让 Claude **新 feat / bug fix 交付前**跑过 typecheck + unit + **Phase 1 e2e**(覆盖 user 操作流程),**全过才算交付**。User runtime 抽查降级为 quality bar / 信任建设,不再是流程必经。

**非目标**:
- 100% 覆盖率(过度工程,DeskFox 规模不需要)
- 替代真桌面测试(承认 5-10% Tauri-only bug 仍 surface 在 user)
- 现在就启动 Phase 2(留待数据驱动)

## 验收标准

| ID | 场景 | 期望 |
|---|---|---|
| **A1** | `bun run --cwd packages/app test:e2e:mock` 启动入口 | 跑全套 Phase 1 e2e,**<2 分钟**全跑完,**0 真后端依赖**(不 fetch `127.0.0.1:4096`) |
| **A2** | `VITE_E2E_MOCK=true` 启动 vite dev | UI hydrate 成功(button visible),SDK / Tauri invoke 全走 mock,文件树 / 编辑器 / 聊天面板均能 render |
| **A3** | 内存 fs 行为对齐真 sidecar watcher | 写 `notes.md` → mtime 自增 + 触发 file.edited event,event shape 严格对照真 SDK type |
| **A4** | bug-repro 示范用例 `auto-save-debounce-flush` | 编辑 → 等 1s → 切 tab → 切回 → 看到新内容 + 无误"AI 修改了此文件"toast(模拟 5-22 那晚 user 报的 3 个 bug,Phase 1 e2e 必须 catch 全部) |
| **A5** | bug-repro 示范用例 `chat-drop-overlay-stuck-fix` | 文件树 row 拖文件 → 浮层消失(测 DOM event bubble / stopPropagation 路径) |
| **A6** | bug-repro 示范用例 `large-file-preview-guard` | 打开 100MB+ .txt → 显示 FileTooLarge 卡 + 2 按钮(测入口闸门 + UX 兜底组件) |
| **A7** | Playwright fixture API 工效 | 写新 case **<20 行**(fixture 抽走 spawn / hydrate / mock setup),Claude 写 case ROI ≥ 真桌面 e2e 10 倍 |
| **A8** | pre-push hook gate | `git push` 前自动跑 Phase 1 e2e,失败拦推送;失败原因清晰可读(stack trace 指向具体 reactive 层) |
| **A9** | 治理 doc v3→v4 同步生效 | `docs/governance/自动化测试规范.md` 升 v4:View 清单硬门槛即时生效 + bug-repro 提级到 Phase 1 e2e + R5 Medium feat 强制 ≥ 1 Phase 1 e2e(无 e2e 不算交付) |
| **A10** | 8 个示范用例总体 | `auto-save` / `chat-drop` / `large-file-preview` 系列共 5-8 个 case 全绿,回填覆盖近期 12 笔 feat 的关键 user flow(v2 §5.3 列表) |

## 架构选型

### 金字塔结构(参 v2 §4.1)

```
                          ↑ 慢 / 真 / 贵
   E2E 真桌面 (10%)       Phase 2,~15 critical path,数据驱动后启,nightly + ship 前跑
                          已有 feat/e2e-real-tauri-webdriver 分支挂账,保留不动

   组件级 e2e ★ (20%)     ★ 本 feat,Vite mock mode + Playwright 控 chromium ★
                          ~50-150 case,<2 min 全套,CI 每 commit 跑(Claude 主战场)

   Unit (70%)             Bun test + pure helpers + 已有 happydom
                          ~640+ case(已有),持续扩
                          ↓ 快 / 假 / 便宜
```

**关键判断**:**中层(组件 + invoke/SDK mock)**是 Claude 自跑 + 抓 90% UI bug 的甜区。E2E 真桌面只覆盖 Tauri 特有(真 IO / 窗口生命周期 / 跨平台渲染),不归本 feat 管。

### 中层 mock e2e vs 真桌面 e2e 对比

| 维度 | 真桌面 E2E | **本 feat 中层 Mock e2e** |
|---|---|---|
| 速度 | 30-60s/case | **1-3s/case** |
| 跑全套时间 | 10-15 分钟 | **<2 分钟** |
| CI 频率 | nightly | **每 commit** |
| 抓 reactive bug | 能 | 能(大部分) |
| 抓真 Tauri / 跨平台 | 能 | 不能(Phase 2 兜) |
| 调试性 | 难(打开真 app) | **易(chromium devtools)** |
| 维护 | Tauri / Playwright 升级易 break | 中等 |
| 起步成本 | 高(saveDialog + sidecar 启动) | 中(mock setup,本 feat) |

### 6 个 setup 组件(参 v2 §5.1)

| 组件 | 内容 | W |
|---|---|---|
| **Vite mock mode** | `VITE_E2E_MOCK=true` 启动 dev server,Vite alias / plugin 把 SDK + Tauri `invoke` 替换为内存 stub | W1 |
| **内存 fs** | `Map<path, { content, mtime, size }>` + watcher event emitter(模拟 sidecar SSE 推 `file.edited` / `file.watcher.updated`) | W1 |
| **Tauri invoke mock 库** | 统一在 `e2e/mocks/tauri.ts`,~10-15 个 stub:`write_text_file` / `get_file_mtime` / `get_file_size` / `read_binary_file_base64` / `open_path` / `write_binary_file_absolute_base64` / `fetch_url_base64` / `feishu_*` 等 | W1-W2 |
| **SDK mock** | `sdk.client.file.read / list / write / officePdf` + chat 相关 endpoints | W2 |
| **Playwright fixture** | helpers: `openFile()` / `startEdit()` / `typeInEditor()` / `switchTab()` / `waitForToast()` / `getFileContent()` / `mockAIWriteFile()` / `dragFileToChat()` / `pasteImage()` 等 | W2 |
| **CI 接入 + 示范用例** | pre-push hook 加 Phase 1 e2e gate + 5-8 个示范用例(auto-save / chat-drop / large-file-preview / chat-input-focus / chat-selection-menu) | W3 |

详细每周切分见 [`2-plan.md`](./2-plan.md)。

## 关键技术决策

### D1 — mock 边界:**只 mock SDK + Tauri invoke,不 mock UI 层**

- Mock 边界画在"前端 → 后端"的两个出口:SDK HTTP 调用 + Tauri invoke
- UI 层(SolidJS 组件 / store / reactive 链)**全是真代码**,这是要测的东西
- 内存 fs 模拟磁盘行为(mtime + watcher event),不模拟前端读写状态

### D2 — mock 跟真后端对齐:contract test 兜底

| Mock 行为 | 对齐方式 |
|---|---|
| `write_text_file` 写盘 | 内存 fs map,模拟 mtime 自增 + 触发 file.edited event |
| `get_file_size` | 算 string utf8 byte length |
| `read` 返回格式 | 严格对照 SDK type definitions(`FileContent` type with `type: "text"\|"binary"`) |
| Watcher event | EventSource mock,event shape 对照真 SDK |
| **漂移防御** | 每周 1 次跑 Phase 2 真 Tauri,跑同样 case,assert 行为一致;漂移立即同步 mock(本 feat W3 起手 contract test 流程,自动化交 Phase 2 时落) |

### D3 — Playwright 浏览器:**只 chromium,不 firefox/webkit**

- DeskFox 实际跑 WebView2(Chromium 内核),Phase 1 mock e2e 只验 Chromium 行为对齐
- 跨浏览器 e2e 是 Web app 需求,DeskFox 是桌面 app,不需要

### D4 — 测试位置:`packages/app/e2e/` 现有目录扩展,不另起

- 现有 `packages/app/e2e/` 已有 `smoke.spec.ts`(Stage ①)和 `*.mock.spec.ts`(Stage ② mock infra,5 个 web mock 跑通)
- 本 feat 新建 `e2e/mocks/` 子目录放 mock 模块,`e2e/fixtures.ts` 放 Playwright fixture,`e2e/specs/` 放业务用例
- 真桌面 e2e 在 `packages/app/e2e-tauri/`,**两个目录命名空间独立**

### D5 — bug-repro 提级:Phase 1 e2e 取代 unit 当默认

R5 v3 规定 bug-repro 测试 + fix 同 commit,实际多笔(`chat-drop-overlay-stuck-fix` 等)只到 unit 层(DOM event 假设)。v4 起 **bug-repro 默认走 Phase 1 e2e**,unit 仅作为 pure helper 内部测试。

Exceptions:bug 在外部依赖 / 仅特殊环境复现 / 修文案 — 同 R5 v3 例外清单。

### D6 — W1 critical path failure 应对

W1 Day 3 必须 demo "VITE_E2E_MOCK=true 起 dev,UI hydrate 成功"。若过不去:

- **time-box 5 个工作日 spike**(W1 全周用满)
- 超时仍走不通 → fallback 方案 A(`webServer` 同时启 opencode server,参 `packages/app/e2e/README.md` §"后续接入路径")
- 触发 fallback 当天同步 user,2-plan.md 加 decision note

## 测试覆盖范围

按 R5 v3 现行规范:本 feat 自身是"测试基础设施" feat,工作产物即测试,**不再额外要求 meta 测试**。但产出的示范用例本身就是 R5 v4 起新流程的样例 + 回填覆盖 12 笔 feat。

| 覆盖维度 | 实现 |
|---|---|
| Phase 1 e2e setup 自洽性 | A1-A3(架子能跑 + UI hydrate + mock 对齐) |
| 示范用例回填 12 笔近期 feat | A4-A6 + A10(8 个示范 case) |
| 工程师工效 | A7(写新 case <20 行) |
| 治理纪律落地 | A8 + A9(pre-push gate + R5 v4 同步生效) |

## 关联文档

| 文档 | 关系 |
|---|---|
| [`OPENCODE-PLAN/需求池/自动化测试-完整方案.md`](../../../../OPENCODE-PLAN/需求池/自动化测试-完整方案.md) v2 | 本 feat 的上位调研方案,1-spec 大量内容拼接自其 §四+§五+§七 |
| [`OPENCODE-PLAN/需求池/自动化测试-长期规划.md`](../../../../OPENCODE-PLAN/需求池/自动化测试-长期规划.md) v1 | 5 期分级 + KPI,上位 |
| [`OPENCODE-PLAN/需求池/e2e-测试基础设施-进展.md`](../../../../OPENCODE-PLAN/需求池/e2e-测试基础设施-进展.md) | Phase 2 真桌面 ledger,本 feat 完后引用其卡点状态 |
| [`docs/governance/自动化测试规范.md`](../../governance/自动化测试规范.md) v2 | 治理 doc,本 feat W3 升 v4(See A9) |
| [`docs/features/e2e-smoke-探路/`](../e2e-smoke-探路/) | Stage ① 探路,已合 main |
| [`docs/features/e2e-mock-infrastructure/`](../e2e-mock-infrastructure/) | Stage ② mock 基础(web 层),本 feat 在其基础上扩到组件 + Tauri invoke 维度 |
| `feat/e2e-real-tauri-webdriver`(本地分支,未合 main) | Phase 2 真桌面挂账,本 feat **不动**它 |

## 投资估算

- **一次性投资**:2-3 周(单人,~16 工作日)
- **持续成本**:每个 feat 加 Phase 1 e2e +30 分钟 / 维护(mock 漂移 + Playwright 升级)~5% feat 时间
- **break-even**:约 2 个月,之后纯收益(假设每月 8-10 个 feat × 2-3 次 ping-pong × 10 分钟节省)

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| W1 Mock vite mode UI hydrate 走不通 | D6 time-box + fallback A |
| Mock 跟真后端漂移 → 测试绿但 prod 红 | D2 contract test 每周 1 次跑真 Tauri 对照 |
| Tauri / Playwright / vite 升级 break | 每升级补 ~半天 setup;频率低 |
| Claude 偷懒 — Phase 1 e2e 写得敷衍 | 治理 v4 写明"每 A 验收点 1 个 case";pre-commit hook 检测 `feat/<id>/` 下 e2e 文件存在 |
| 跨平台 bug(Win vs Mac)漏 | Phase 2 真桌面分平台跑;Phase 1 mock 屏蔽平台差异不抓这层 |
| Tauri-only bug 仍需 user 验 | 承认 5-10% bug 仍 surface 在 user runtime(非目标段已声明) |

## 决策点(已锁)

| # | 决策 | 答案 |
|---|---|---|
| 1 | scope:Phase 1 mock e2e 主投资 + Phase 2 真桌面滞后 | ✅ 同意 |
| 2 | R5 治理升级 v3 → v4 | ✅ 同意,**W3 完成同 commit** 切 v4(setup 期间保 v3) |
| 3 | 启动时机 | ✅ 立即(2026-05-23 启动) |
| 4 | Phase 2 是否等 Phase 1 跑半年 | ✅ 是,数据驱动 |
| 5 | CI 平台 | ✅ 先 pre-push hook 起步,半年后再考虑 GitHub Actions |
