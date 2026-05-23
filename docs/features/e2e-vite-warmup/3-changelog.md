---
feat-id: e2e-vite-warmup
status: done
related: ./3-changelog.md
---

# e2e-vite-warmup — 3-changelog

> **R5 v4 flaky 48h 内修履约**:vite mock dev server 冷启动 + Playwright 多 worker 并行 → 第 1 批 2-3 spec timeout 偶发 fail。修法 = vite warmup + Playwright globalSetup 双保险。

> **背景规范见**:`OPENCODE-PLAN/需求池/e2e-vite-cold-start-flaky.md`(已闭环,本 commit 同时删)。Tiny+ 规模,1-spec / 2-plan 省(背景文档替代)。

## 一句话

`vite/e2e-mock.js` server.warmup 配 8 个核心组件文件(方案 D)+ `e2e/global-setup.ts` 跑测试前真 chromium 加载 `/` 一次让所有 module 编完(方案 A)双保险。**4 次连跑全过(23.3 / 20.4 / 20.7 / 24.0s,含真冷启动),0 flaky**。

## 改动清单

| 文件 | 改动 | 行数 | 角色 |
|---|---|---|---|
| `packages/app/vite/e2e-mock.js` | 加 server.warmup.clientFiles(方案 D)| +18 | vite 启动主动预编 8 文件 |
| `packages/app/e2e/global-setup.ts` | 新文件,跑测试前 chromium fetch / 一次(方案 A)| +34 | 真浏览器兜底 warmup,~5-7s |
| `packages/app/playwright.config.ts` | 接 globalSetup | +2 | config |
| `docs/features/e2e-vite-warmup/3-changelog.md` | 新文档 | +80 | 本 changelog |
| `docs/features/INDEX.md` | feat 入口 | +1 | 索引 |
| `OPENCODE-PLAN/需求池/e2e-vite-cold-start-flaky.md` | **删除**(已闭环)| -77 | backlog 关闭 |

**总:~58 行代码 + ~80 行文档**,Tiny+ 规模。

## 验证

| 跑次 | vite 状态 | e2e 时长 | 结果 |
|---|---|---|---|
| 1 | 半冷(Node JIT cached) | 23.3s | 11 pass / 1 skipped |
| 2 | warm | 20.4s | 11 pass / 1 skipped |
| 3 | warm | 20.7s | 11 pass / 1 skipped |
| 4 | **真冷启动**(刚 kill vite + 重起) | 24.0s | 11 pass / 1 skipped |

冷热差 ~3s,**0 spec fail 在任何一次**。globalSetup 自身 ~5-7s 开销(真 chromium 加载 + networkidle + 1.5s 缓冲),换走"100% 可预测的全过"值。

修前:第 1 次跑(冷启动)`mock-foundation` + `bug-repro-chat-drop-overlay` 偶发 timeout fail。
修后:N 次跑全过,无任何 flaky。

## 影响范围

### 生产 build:0 影响
- vite warmup 配在 e2e-mock plugin config hook 内,只在 `--mode e2e-mock` / `VITE_E2E_MOCK=true` 时激活
- globalSetup 只在 Playwright 跑测试时启动,生产路径不接触

### 现有 dev workflow:0 影响
- `bun run dev`(普通模式)不变
- `bun run test:e2e` 现在每次跑前先 globalSetup +5-7s,但换"全过"值

### 关键模块清单 / R5 v4
- 不动 governance 文档,本笔是 R5 v4 "flaky 48h 内修"原则的首次履约,deadline 2026-05-25,提前 2 天落地

## 回退方法

如需回退本 feat:
1. `git revert <commit-hash>` 撤掉本笔
2. 已删的 backlog 文件可从 git history 恢复(`git show HEAD~1:OPENCODE-PLAN/需求池/e2e-vite-cold-start-flaky.md`)
3. 回退后 R5 v4 flaky 原则破坏,backlog 重新打开

## 跟进

下个动作建议:**pre-push hook gate**(`e2e-phase1-mock-mode` follow-up backlog 第 1 项)— flaky 修通了 gate 才能装(否则装上立刻误拦人 push)。1d 工程量,接到 husky `.husky/pre-push` 即可。

## 规模 / R 标记

- **规模**:Tiny+(~58 代码 + ~80 文档,3 文件改 + 1 新建 + 1 删除)
- **R1 三级跳**:1 新文件 + 2 上游/fork 文件改各加几行 ✅
- **R2 FORK marker**:vite/e2e-mock.js 加 FORK 注释段;global-setup.ts 头注 `[feat: e2e-vite-warmup]`;playwright.config.ts 1 行 FORK 注释
- **R3 / R6 / R7**:N/A
- **R4 黑名单 override**:**第 2 笔本季**(`packages/app/playwright.config.ts`)— 详 R4 论证段 ⬇
- **R5 v4**:本笔是首次"flaky 48h 内修"履约 — 2026-05-23 立 backlog,2026-05-23 同日修通

## R4 override 论证 — `packages/app/playwright.config.ts`

### 改动内容(2 行)

```diff
+  // FORK: vite mock 冷启动 warmup [feat: e2e-vite-warmup] 2026-05-23
+  globalSetup: "./e2e/global-setup.ts",
```

只增 1 行实际 config + 1 行 FORK 注释,**不删 / 不改任何已有 config**。

### Wrapper 不可行性论证

| 替代方案 | 可行性 | 否决理由 |
|---|---|---|
| 环境变量驱动 globalSetup | ❌ | Playwright globalSetup 必须从 config 注入,无环境变量 API |
| fork `playwright.fork.config.ts` + 改 npm script | 🟡 | 需新建 fork config 继承 base + 改 `test:e2e` script 指 fork config。**但 `packages/app/package.json` 也可能在黑名单**,反而触发更多 override;且本仓所有 e2e 文档假设 `test:e2e` = base config,引入 fork config 加认知成本,**净增工程复杂度大于 override 收益** |
| 从测试代码内 inline warmup | ❌ | Playwright test 不能 globalSetup,只能 beforeAll 在每个 worker 内重复 — 多 worker 浪费 5-7s × N,且不能保证测试启动前已编译 |

**结论**:wrapper 路径成本高于 R4 override。

### 风险评估

| 维度 | 评估 |
|---|---|
| 上游 merge 冲突风险 | 低 — 只加 1 行 globalSetup config + 1 行注释,与上游 config 任何字段都不冲突 |
| FORK marker | ✅ 2 行均带 `[feat: e2e-vite-warmup]` tag,merge 时 sync-guide §4 自动可见 |
| 产品行为影响 | 0 — globalSetup 只在 Playwright 跑 e2e 时启动,生产路径 0 接触 |
| 回退成本 | 低 — `git revert` 1 笔即可 |
| 季度配额 | 第 2 笔本季 / 配额上限 2 笔(刚到上限) |

### 季度配额状态(2026-Q2)

| # | feat | override 文件 | 日期 |
|---|---|---|---|
| 1 | `feishu-pipeline-401-fix` | `packages/desktop/src-tauri/src/lib.rs` | 2026-05-23 |
| **2** | **`e2e-vite-warmup`**(本笔) | **`packages/app/playwright.config.ts`** | **2026-05-23** |

**本季配额已用满**(2/2)。下季度起重新计数。如本季再撞 R4 需特批扣下季度,详 CLAUDE.md R4 第 3 条。

## 时间戳

- 立 backlog + 修 + 验 + 收尾:2026-05-23 单日
