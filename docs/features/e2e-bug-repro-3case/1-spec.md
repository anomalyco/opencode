---
feat-id: e2e-bug-repro-3case
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# e2e-bug-repro-3case — 1-spec

> **Phase 1 mock e2e 首批 bug-repro 示范用例** — 把 3 个已修 bug 用 Phase 1 框架复现,既验证 mock 框架够力,又回填测试覆盖

## 需求来源

`e2e-phase1-mock-mode` 已 done(commit `352f90991`),smoke 8/8 过,但 spec 验收点 A4 / A5 / A6 的"bug-repro 示范用例"还没落地。本笔补这 3 个,关 ping-pong 循环的最后一块拼图 — 以后改这块代码 Claude 自己跑 e2e 就能确认,不再丢 user 测。

## 选这 3 个的理由

- 都是 2026-05-18 ~ 22 之间真撞过的 reactive 层 bug(可观察 + 已修 + memory 有完整记录)
- 各代表一类典型场景:UI 闸门组件 / DOM 事件流 / 异步 reactive 编辑链路
- 覆盖 Phase 1 框架的不同能力面:`setMockFileSize` override / DnD 事件模拟 / 编辑 + memfs + 多 tab 切换

## 验收标准

| ID | 场景(对应 Phase 1 spec A4/A5/A6)| 期望 |
|---|---|---|
| **A1** | `bug-repro-large-file-preview-guard.spec.ts` | mock 100MB+ .txt → 打开后看到 `文件过大,跳过预览` 卡 + 2 按钮(`用本机软件打开` / `打开所在文件夹`)|
| **A2** | `bug-repro-chat-drop-overlay-stuck-fix.spec.ts` | 模拟文件树 row 拖文件 → drop 后 prompt-input 上 `border-dashed` 类应消失(window capture-phase 兜底生效)|
| **A3** | `bug-repro-auto-save-debounce-flush.spec.ts` | 进入编辑态改内容 → 等 debounce 触发 → 验 memfs 含新内容 + 无误"AI 修改了"toast(markSelfWriting 500ms 窗口生效)|
| **A4** | 全部 spec | 用 `test:e2e:mock` 跑,**全过 + <30s** |
| **A5** | bug-repro 命名规范 | 文件名 `bug-repro-<feat-id>.spec.ts`,test 标题含 `[bug-repro: <一句话>]`(对齐 R5 v4 commit message 约定)|

## 架构选型

直接复用 `e2e-phase1-mock-mode` 已建的 7 个 fixture helper,不引入新基础设施。每个 spec 独立文件,失败定位干净。

| spec | 复用的 fixture | 新需要的 |
|---|---|---|
| A1 large-file | `bootstrapMock` / `mockFileTree` / `setMockFileSize` | 无 — 全 ready |
| A2 chat-drop | `bootstrapMock` / `mockFileTree` | 无 — 用 page.dispatchEvent 触发 DnD |
| A3 auto-save | `bootstrapMock` / `mockFileTree` / `preloadFile` + memfs read 验证 | 无 — 用 page.evaluate 直接读 memfs |

## 关键技术决策

### D1 — 不模拟完整 user click 全程

A3 auto-save 最棘手:user 真路径是 file tree 点击 → 进入文件查看器 → 点编辑 → CodeMirror 打字 → 切 tab。CodeMirror 在 mock 环境的输入模拟比较脆,**优先验"reactive 链路 + memfs 同步"**,不强求 codemirror 真打字。如有必要可降级用 `page.evaluate` 直接驱动 store 改 draft → 触发 debounce → 验 memfs。

### D2 — A2 chat-drop DOM 事件模拟用 `page.dispatchEvent`

不用 Playwright `dragTo`(那是 HTML5 drag-and-drop API 的高层模拟,跟内部 stopPropagation 路径互动不可控)。用底层 DataTransfer + `dispatchEvent("drop")` 精准模拟 file-tree 行 onDrop stopPropagation 场景。

### D3 — 命名规范

`bug-repro-<feat-id>.spec.ts` — 一眼看出是哪个 bug 的回归守护,跟 `mock-foundation.spec.ts`(smoke)区分开。

## R 合规预判

- **R2** FORK marker:每个 spec 文件头注 + 已建 fixture 无改动
- **R3** 不涉及
- **R4** 0 override(全在 `packages/app/e2e/` 白名单)
- **R5** **本笔本身就是 R5 v4 落地** — bug-repro 提级到 Phase 1 e2e,这 3 个就是首批示范
- **R6** 不涉及

## 工程量估算

- A1 large-file:~50 行 / 0.5h
- A2 chat-drop:~80 行 / 1.5h(DnD 模拟踩坑)
- A3 auto-save:~100 行 / 2h(reactive 链路探索)
- 三文档 + INDEX + 改动日志:~150 行 / 1h

**总:~380 行 / 5h(0.5-1 工作日)**,Medium 规模偏小。

## 待 user 审签

- scope 是否对齐"先做 3 个示范"(不扩到第 4-N 个)?
- D1 降级方案(必要时跳过 codemirror 真打字直接驱动 store)是否可接受?
