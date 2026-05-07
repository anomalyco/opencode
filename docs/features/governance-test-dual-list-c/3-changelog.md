---
feat-id: governance-test-dual-list-c
status: done
related: ./3-changelog.md
---

# 3-changelog — 测试治理规范升级到双清单(选项 C)

## 起源

D 系列实施完成后(D4 → D3 → D1 → D2,测试 320 → 532),发现 R5 决策 2 单清单"文件级行覆盖率 ≥ 80%"对 SolidJS 组件文件不合用 — JSX 大部分声明式 view layer 不适合 unit 测。

Claude 给 user 三选项:
- **A**:修订清单语义 — helper 文件入清单,组件文件移出
- **B**:接受组件低覆盖率,view layer 等 e2e
- **C**:**双清单** — Logic 行覆盖 + View e2e,helper extract 模式正式入规则

user 选 **C**。本笔实施。

## 改动清单

### 修改 — `docs/governance/自动化测试规范.md`

决策 2 段重写:
- 单"关键模块清单"→ 拆成 **Logic 清单 + View 清单**
- Logic 清单门槛:**单元测试行覆盖率 ≥ 80%**;条目:`md-export-docx.ts`(~100%)/ `markdown-editor-extensions.ts`(~75%)/ `dialog-settings-version.ts`(~100%,D1 抽出)/ `file-tabs-helpers.ts`(~100%,D2 抽出)
- View 清单门槛:**至少 1 个 e2e happy path**;条目:`dialog-settings.tsx`("切语言看版本牌正确" + "打开关闭设置面板") / `file-tabs.tsx`("右键菜单 4 项 disabled 状态" + "切 tab 标题更新" + "选 .md 显示编辑器")
- View 清单的 trigger 效应:**第 1 个文件加入时,必须先解决 e2e 基础设施 setup**(opencode sidecar 或前端 mock mode)
- helper extract 模式正式承认 — 组件抽出的 helper 进 Logic 清单 + 原组件留 View 清单
- 双清单关系图(Logic vs View 对照)
- 跨清单移动规则
- 修订记录加 v2 段

### 修改 — `CLAUDE.md`

R5 测试纪律段:
- "关键模块覆盖率 ≥ 80%" → 改成 "**关键模块双清单**(Logic 行覆盖 80% + View e2e ≥ 1 happy path)"
- 加 "helper extract 模式正式承认"行
- 加 "View 清单硬门槛**等 e2e 基础设施 setup 后**生效"行
- 修订记录加 v3.1(2026-05-07 选项 C)

### 修改 — `OPENCODE-PLAN/需求池/自动化测试-长期规划.md`

- 第七章治理决策 2 行更新("v2 升级双清单")
- 修订记录加 v1.2 段

## 4 个文件分配到双清单

| 原清单(v1)| 新位置(v2)| 状态 |
|---|---|---|
| `md-export-docx.ts` | Logic 清单 | ~100% ✅ |
| `markdown-editor-extensions.ts` | Logic 清单 | ~75% ⚠ |
| `dialog-settings.tsx` | **拆成两个**:`dialog-settings.tsx` 进 View 清单 + `dialog-settings-version.ts` 进 Logic 清单 | helper 100% / view 待 e2e |
| `file-tabs.tsx` | **拆成两个**:`file-tabs.tsx` 进 View 清单 + `file-tabs-helpers.ts` 进 Logic 清单 | helper 100% / view 待 e2e |

净结果:
- **Logic 清单 4 个文件**(2 utility + 2 helper extract)
- **View 清单 2 个文件**(2 SolidJS 组件)

## 影响

- **Logic 清单**:从此刻起按 80% 行覆盖严格守门,新 feat 加 Logic 文件需 user 拍板
- **View 清单**:**门槛延后**(e2e 基础设施未 ready),"准入但不强制"状态;基础设施 ready 后立刻生效
- **未来 feat**:写新 SolidJS 组件时,作者会被迫思考"是否抽 helper" — 因为 helper 进 Logic 清单是低成本 80%,组件直接进 View 清单要带 e2e(成本高)
- **e2e 实施压力增加**:View 清单存在但门槛未生效是"权宜",长期 user 必须解决 e2e 基础设施(否则 View 清单永远是空话)— 这正是 C 方案设计的目的(逼着 e2e 走通)

## 没动的

- 决策 1 / 3 / 4 / 5 不动(只升级决策 2)
- 现有测试代码不动(只是清单语义变,不重测)
- 第 1 期实施时机不变(user 单独决定)

## 规模 / R 标记

- 规模:Tiny(治理规范修订,~120 行净增 / 3 文件 / 0 R4 / 0 上游侵入)
- R2 FORK marker:不适用(纯 docs)
- R3 黑名单:无
- R4 override:无
- R5 测试纪律:本 feat **就是治理规则升级**,自身不需要测试

## 下一步

V2 双清单生效**之后**的几个 follow-up(无固定排期):

1. **e2e 基础设施 setup** — opencode sidecar / 前端 mock mode 二选一(View 清单门槛生效的前置依赖)
2. **markdown-editor-extensions.ts** 推到 80%(剩 readFileAsBase64 / handleImageDrop 异步路径,需 D4 的 invoke mock + D3 的 EditorView fixture 组合)
3. **first View e2e** — 完成 sidecar setup 后,给 dialog-settings.tsx 写第 1 个 e2e
