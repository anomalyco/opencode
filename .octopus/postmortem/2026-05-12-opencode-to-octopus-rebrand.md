# 复盘: v0.1.0 OpenCode → Octopus 品牌迁移

> 事件：v0.1.0 品牌迁移 P6→P9 执行复盘
> 日期：2026-05-12
> 严重等级：P2（过程改进，非事故）
> 负责人：orchestrator

## 概述

本次复盘针对 v0.1.0 OpenCode → Octopus 品牌迁移的 P6→P9 执行过程。非线上事故，而是过程回顾——总结执行中暴露的问题，提炼改进措施。

## 时间线（UTC+8）

| 时间 | 事件 |
|------|------|
| P6 | 9 个 Issue 编码完成，1967 文件改动，1 次 commit |
| P7 启动 | P6 代码提交后立即进入 P7 质量门 |
| +0h | oxlint: ✅ 0 errors, 3015 warnings |
| +0h | prettier: ❌ 143 文件格式问题 → 自动修复 |
| +5m | typecheck 全量: ✅ 14/14 |
| +10m | build 全量: ❌ `desktop:build` 失败 — `cd ../opencode` 路径残留 |
| +15m | 修复 `packages/desktop/scripts/prebuild.ts`, `packages/desktop/scripts/predev.ts` |
| +20m | build 重试: ❌ `console-app:build` 失败 — `../../opencode/script/schema.ts` 残留 |
| +25m | 修复 `packages/console/app/package.json`, `packages/sdk/js/script/build.ts` |
| +30m | build 重试: ❌ `desktop:build` 并行竞态失败 |
| +35m | build 串行: ✅ 9/9 |
| +40m | test:ci: ✅ 2588 pass / 5-9 flaky (pre-existing) |
| +45m | rebrand verification: ✅ 5/5 |
| P8 | release/v0.1.0 分支创建 |
| P9 | CHANGELOG.md 编写 + tag v0.1.0 打标 |

**P7 阻塞总时长**: ~35分钟（3 次 build 重试，修复 4 处残留路径）

## 根因（5 Whys）

### 问题 1: P7 build 因残留 `opencode` 路径失败

1. **为什么** build 失败？ → `packages/desktop/scripts/prebuild.ts` 中仍有 `cd ../opencode`
2. **为什么** 这个引用没被 P6 迁移到？ → P6 的 Issue #2（目录重命名）和 Issue #8（CI/脚本）分别处理，但 `prebuild.ts` 引用了跨包路径，不在任何 Issue 的 grep 范围内
3. **为什么** grep 范围没覆盖到？ → 版本计划按「文件类型」划分 Issue（npm scope / 目录 / API / 配置 / 资产 / 扩展 / CI / 文档），但 shell 脚本中的跨包路径是隐式的「运行时依赖」关系
4. **为什么** 按文件类型划分而非按依赖链划分？ → 版本计划优先关注文件重叠避免并行冲突，未建模「构建时的跨包执行依赖」
5. **为什么** 未建模构建时依赖？ → 版本计划只做文件级冲突检测（同文件/同包），不做运行时/构建时依赖链的验证。**系统性原因：版本计划的冲突检测仅覆盖静态文件交集，遗漏了构建执行路径。**

### 问题 2: Desktop 并行构建竞态失败

1. **为什么** desktop build 在全量并行中失败但单独成功？ → `electron-vite build` 依赖 `prebuild.ts` 中生成的 `../octopus/dist/node/node.js`，但并行构建中 octopus 包可能尚未完成
2. **为什么** turbo.json 中 build 任务没有声明 `dependsOn`？ → 当前 `turbo.json` 中 `build` 任务的 `dependsOn` 为空数组 `[]`
3. **为什么** 没有声明依赖？ → 历史上可能因为循环依赖问题不敢加
4. **根本原因**：turbo 任务图未反映真实的包间构建依赖，依赖隐式顺序（`^build` 未声明）而非显式契约。

### 问题 3: 143 文件 prettier 格式问题

1. **为什么** P6 提交包含格式问题？ → P6 编码未执行 prettier 自检门
2. **为什么** 未执行？ → P6 自检门 checklist 有 `prettier --check .` 但实际执行时被跳过（1967 文件规模的提交，人工可能遗漏）

## 影响范围

| 维度 | 详情 |
|------|------|
| 影响用户数 | 0（未发布，内部执行阶段） |
| 影响时长 | ~35 分钟（P7 build 反复修复） |
| 影响功能 | Desktop / Console-app / SDK 构建脚本 |
| 残留问题数 | 4 处 `opencode` 路径（已修复） |
| Pre-existing 问题 | 5-9 flaky tests, 3015 oxlint warnings, turbo 任务图不完整 |

## 改进措施

| # | 措施 | 类型 | 优先级 | 说明 |
|---|------|------|:---:|------|
| 1 | **P6 门控增加 `verify-rebrand.ts`** | 预防 | P0 | 脚本已存在，应在每个 Issue 完成时自动运行，而非等到 P7 |
| 2 | **修复 turbo.json build 任务依赖** | 预防 | P1 | `desktop#build` 应 `dependsOn: ["octopus#build"]`；排查其他隐式依赖 |
| 3 | **版本计划增加「构建依赖链」建模** | 预防 | P1 | P2 冲突检测应包含构建时/运行时依赖，不仅文件交集 |
| 4 | **pre-commit hook: 检查跨包路径引用** | 检测 | P2 | `rg '\.\./opencode'` 或类似 pattern 在 commit 时拦截 |
| 5 | **修复 flaky tests** | 缓解 | P2 | 5-9 个失败测试应逐一排查修复或标记 skip |
| 6 | **P6 自检门自动化** | 预防 | P2 | P6 提交前自动运行 `oxlint + prettier + typecheck`，阻止未通过检查的提交 |

## 回顾 Checklist

- [x] 时间线完整无遗漏
- [x] 根因分析到了系统性层面（版本计划建模缺陷、turbo 任务图缺失）
- [x] 改进措施可执行、可量化、有优先级
- [ ] 改进措施已转化为 GitHub Issue（待 P10.2）

## 做得好的地方

- oxlint 零错误，说明 P6 代码没有引入新的 lint 错误
- typecheck 14/14 全量通过，一次成功
- rebrand verification 脚本 (`verify-rebrand.ts`) 设计优秀，在 P7 中起到了关键的二次验证作用
- 2588/2597 测试通过，迁移几乎没有破坏现有功能
- P7 中发现的所有残留路径问题都在 35 分钟内修复完成
