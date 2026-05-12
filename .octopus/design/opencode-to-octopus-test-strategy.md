# P5 测试策略 — OpenCode → Octopus 品牌迁移

> **版本**: v0.1.0 · **变更级别**: XL (~735 文件, 9 Issues) · **日期**: 2026-05-11
> **上游**: P3 需求分析 `.octopus/research/opencode-to-octopus-rebrand.md` · 版本计划 `.octopus/version-plans/v0.1.0.md`
> **设计者**: qa domain agent · **质量否决权**: 是

---

## 目录

1. [测试执行顺序](#1-测试执行顺序)
2. [Issue 级质量门](#2-issue-级质量门)
3. [端到端冒烟测试](#3-端到端冒烟测试)
4. [Canary 监控方案](#4-canary-监控方案-p8)
5. [回归风险区域](#5-回归风险区域)
6. [验证脚本实现规划](#6-验证脚本实现规划)
7. [质量门报告模板](#7-质量门报告模板)

---

## 1. 测试执行顺序

### 1.1 测试层级定义

| 层级             | 范围                                              |   耗时   | 触发条件              |
| ---------------- | ------------------------------------------------- | :------: | --------------------- |
| **L0: 静态验证** | `grep` / `rg` 残留检测, 目录存在性                |   <30s   | 每个 Issue 完成       |
| **L1: 编译验证** | `bun turbo typecheck`, 单包 `tsgo --noEmit`       |  1-3min  | 每个 Issue 完成       |
| **L2: 包集成**   | `bun test`, HttpApi exerciser, 单包 unit          | 3-10min  | Group 内 Issue 完成   |
| **L3: 全量 CI**  | `bun turbo test:ci`, e2e (Playwright), HttpApi    | 15-30min | Group 完成 / 全量验证 |
| **L4: 冒烟**     | `script/rebrand-smoke.ts` — CLI/扩展/发布 dry-run | 5-10min  | 全部 9 Issue 完成后   |
| **L5: Canary**   | 灰度环境监控 24h                                  |   24h    | P8 阶段               |

### 1.2 按 Issue 的测试执行序列

```
时序        Agent          Issue         测试门
──────────────────────────────────────────────────────────────────────
t0          core-dev       #1 scope 替换  → L0 + L1 + bun install
                            ↓              (阻断所有后续)
t1          core-dev       #2 目录 rename  → L0 + L1
                            ↓              (阻断 Group 2)
t2a         core-dev       #4 env/flags    → L0 + L1 + L2 (packages/core)
t2a         core-dev       #5 配置系统      → L0 + L1 + L2 (packages/octopus config 相关)
                            ↓
t2b         feature-dev    #6 品牌资产      → L0 + L1 (packages/ui)
t2b         feature-dev    #7 扩展          → L0 + L1 (sdks/vscode, extensions/zed)
t2b         feature-dev    #3 API 标识符    → L0 + L1 + L2 (packages/sdk/js, octopus, plugin)
                            ↓
t2c         platform       #8 CI/CD URL    → L0 + L3 (CI 全绿验证)
                            ↓
t3          feature-dev    #9 文档/i18n    → L0 + L1 (web build) + L3
                            ↓
t4          qa             全量验证        → L3 + L4 (冒烟)
                            ↓
t5          platform       Canary 发布     → L5 (24h 监控)
```

### 1.3 详细执行清单

#### 每个 Issue 提交前的最小门

所有 Issue 共享的最小门:

```
┌─────────────────────────────────────────────┐
│  [L0] 该 Issue 相关的 grep 残留检测零通过    │
│  [L1] 受影响的包 `bun run typecheck` 通过    │
│  [L0] verify-rebrand 对应检查项通过          │
└─────────────────────────────────────────────┘
```

#### Issue 1 (npm scope) 提交前

| 步骤                   | 命令                                                                                                                       | 预期                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| L0: scope 残留         | `rg '@opencode-ai' --type ts --type json packages/`                                                                        | 零结果                |
| L0: exclude 清单完整   | `rg '@opencode-ai' packages/ \| grep -f <exclude_list>`                                                                    | 仅含排除项            |
| L0: lock 文件一致性    | `bun install --frozen-lockfile 2>&1`                                                                                       | 无 workspace 解析错误 |
| L1: 全量 typecheck     | `bun turbo typecheck`                                                                                                      | 全通过                |
| L1: 受影响包 typecheck | `for pkg in packages/sdk/js packages/core packages/plugin packages/ui packages/app; do cd $pkg && bun run typecheck; done` | 全通过                |
| 提交后 CI              | 等待 `test.yml` CI 绿                                                                                                      | pipeline 全绿         |

#### Issue 2 (目录 rename) 提交前

| 步骤               | 命令                                                       | 预期                    |
| ------------------ | ---------------------------------------------------------- | ----------------------- |
| L0: 旧目录不存在   | `test ! -d packages/opencode`                              | exit 0                  |
| L0: 路径引用残留   | `rg 'packages/octopus/' --type ts --type json --type yaml` | 零结果 (排除 changelog) |
| L0: sst.config.ts  | `rg 'opencode' sst.config.ts`                              | 零结果 (排除已更新)     |
| L1: 全量 typecheck | `bun turbo typecheck`                                      | 全通过                  |

#### Issue 3 (API 标识符) 提交前

| 步骤                   | 命令                                                                      | 预期                  |
| ---------------------- | ------------------------------------------------------------------------- | --------------------- |
| L0: API 标识符残留     | `rg -i 'opencodeclient\|createopencode' packages/`                        | 零结果                |
| L1: 受影响包 typecheck | `bun turbo typecheck --filter=@opencode-ai/sdk --filter=@opencode-ai/app` | 全通过                |
| L2: SDK 测试           | `cd packages/sdk/js && bun test`                                          | 全通过                |
| L2: octopus 包测试     | `cd packages/octopus && bun test`                                         | 全通过 (已知失败除外) |

#### Issue 4 (env flags) 提交前

| 步骤               | 命令                                                        | 预期                                  |
| ------------------ | ----------------------------------------------------------- | ------------------------------------- |
| L0: flag.ts 残留   | `grep 'OPENCODE_' packages/core/src/flag/flag.ts`           | 零结果                                |
| L0: 全仓 env 残留  | `rg 'OPENCODE_' packages/core/`                             | 零结果 (排除 OTEL\__ / @openauthjs/_) |
| L0: global.ts      | `grep 'opencode' packages/core/src/global.ts`               | 零结果                                |
| L1: core typecheck | `cd packages/core && bun run typecheck`                     | 通过                                  |
| L2: core 测试      | `cd packages/core && bun test`                              | 通过                                  |
| L2: 兼容双读验证   | `OPENCODE_DB=:memory: OCTOPUS_DB= ./dist/octopus --version` | 启动成功                              |

#### Issue 5 (配置系统) 提交前

| 步骤                     | 命令                                                | 预期   |
| ------------------------ | --------------------------------------------------- | ------ |
| L0: .opencode 不存在     | `test ! -d .opencode`                               | exit 0 |
| L0: opencode.jsonc 残留  | `rg 'opencode\.jsonc' packages/octopus/src/`        | 零结果 |
| L1: octopus 包 typecheck | `cd packages/octopus && bun run typecheck`          | 通过   |
| L2: 配置加载测试         | `cd packages/octopus && bun test --filter="config"` | 通过   |

#### Issue 6 (品牌资产) 提交前

| 步骤               | 命令                                                                     | 预期                        |
| ------------------ | ------------------------------------------------------------------------ | --------------------------- |
| L0: 主题残留       | `grep 'opencodeTheme\|opencode\.json' packages/ui/`                      | 零结果                      |
| L0: CSS class 残留 | `rg 'opencode-theme\|opencode-find\|opencode-line-comment' packages/ui/` | 零结果                      |
| L0: 图标文件       | `test ! -f packages/ui/icons/opencode.svg`                               | exit 0                      |
| L1: ui typecheck   | `cd packages/ui && bun run typecheck`                                    | 通过 (如果该包有 typecheck) |

#### Issue 7 (扩展) 提交前

| 步骤              | 命令                                                                         | 预期                     |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------ |
| L0: VS Code 残留  | `rg 'opencode\.\|"opencode"' sdks/vscode/`                                   | 零结果 (排除保留项)      |
| L0: Zed 残留      | `rg 'id = "opencode"\|\[agent_servers\.opencode\]' packages/extensions/zed/` | 零结果                   |
| L1: VSIX 打包     | `cd sdks/vscode && bun run package 2>&1`                                     | 打包成功, 无命令 ID 冲突 |
| L1: Zed toml 验证 | `bunx toml-validator packages/extensions/zed/extension.toml`                 | 格式正确                 |

#### Issue 8 (CI/CD) 提交前

| 步骤                | 命令                                                          | 预期                              |
| ------------------- | ------------------------------------------------------------- | --------------------------------- |
| L0: workflow 残留   | `rg 'anomalyco/opencode' .github/`                            | 零结果 (保留模型 ID)              |
| L0: artifact 名残留 | `rg 'opencode-darwin\|opencode-linux\|opencode-win' .github/` | 零结果                            |
| L0: 发布脚本残留    | `rg 'opencode-darwin' packages/octopus/script/`               | 零结果                            |
| L0: email 地址      | `grep -r 'opencode@sst.dev' .github/`                         | 零结果                            |
| L3: CI 触发验证     | 推送到分支触发 CI                                             | `test.yml` + `typecheck.yml` 全绿 |

#### Issue 9 (文档/i18n) 提交前

| 步骤              | 命令                                                          | 预期                       |
| ----------------- | ------------------------------------------------------------- | -------------------------- |
| L0: i18n key 残留 | `rg 'opencode_version\|opencode_name' packages/web/src/i18n/` | 零结果                     |
| L0: MDX 路径残留  | `rg '\.config/opencode' packages/web/src/content/docs/`       | 零结果                     |
| L0: commands 残留 | `rg '`opencode'` packages/web/src/content/docs/`              | 零结果                     |
| L1: astro build   | `cd packages/web && astro build 2>&1`                         | 构建成功, 无未替换引用警告 |
| L3: 文档抽查      | 人工审查 20% MDX (统计抽样): 命令=octopus, 路径=.octopus/     | 通过                       |

### 1.4 Group 完成后的全量验证

#### Group 0 (Issue 1) 完成后

```
bun install --frozen-lockfile        # lock 一致
bun turbo typecheck                   # 全量类型检查
bun turbo test:ci                     # 全量单元测试
rg '@opencode-ai' packages/           # scope 零残留
```

#### Group 1 (Issue 2) 完成后

```
bun turbo typecheck                   # 全量类型检查
rg 'packages/octopus/' --type ts --type json --type yaml   # 路径零残留
```

#### Group 2 (Issues 3-8) 全部完成后

```
bun turbo typecheck                   # 全量类型检查
bun turbo test:ci                     # 全量单元测试
cd packages/opencode && bun run test:httpapi   # HttpApi 门
rg -i 'opencode' packages/ --type ts --type json | grep -v -f exclude_list  # 综合残留检查
```

#### Group 3 (Issue 9) 完成后 + 最终验证

```
# 1. 全量 CI
bun turbo typecheck
bun turbo test:ci
cd packages/opencode && bun run test:httpapi

# 2. 全量 grep 综合检查
../../script/verify-rebrand.ts --all

# 3. 冒烟测试
../../script/rebrand-smoke.ts

# 4. Playwright e2e (仅 linux)
cd packages/app && bun run test:e2e:local

# 5. 报告生成
# 输出到 .artifacts/quality-gate/rebrand-v0.1.0-report.md
```

---

## 2. Issue 级质量门

### 2.1 门定义

每个 Issue 完成时, 执行 agent **必须通过所有门控** 才能标记 Issue Complete。门控结果记录在 `.artifacts/quality-gate/gate-issue-N.md`。

### 2.2 门矩阵

|  #  | Issue       | 门 G1 (grep)                                    | 门 G2 (编译)                                       | 门 G3 (测试)                                           | 门 G4 (特殊)                       |
| :-: | ----------- | :---------------------------------------------- | :------------------------------------------------- | :----------------------------------------------------- | :--------------------------------- |
|  1  | npm scope   | `rg '@opencode-ai' → 零`                        | `bun turbo typecheck` ✅                           | —                                                      | `bun install --frozen-lockfile` ✅ |
|  2  | 目录 rename | `rg 'packages/octopus/' → 零`                   | `bun turbo typecheck` ✅                           | —                                                      | `test ! -d packages/opencode` ✅   |
|  3  | API 标识符  | `rg -i 'opencode\|createopencode' → 零`         | `bun turbo typecheck --filter=@opencode-ai/sdk` ✅ | `cd packages/sdk/js && bun test` ✅                    | —                                  |
|  4  | env/flags   | `rg 'OPENCODE_' packages/core/ → 零`            | `cd packages/core && bun run typecheck` ✅         | `cd packages/core && bun test` ✅                      | 双读兼容测试 ✅                    |
|  5  | 配置系统    | `rg '\.opencode\|opencode\.jsonc' → 零`         | `cd packages/octopus && bun run typecheck` ✅      | `cd packages/octopus && bun test --filter="config"` ✅ | —                                  |
|  6  | 品牌资产    | `rg 'opencodeTheme' packages/ui/ → 零`          | `cd packages/ui && bun run typecheck` ✅           | —                                                      | —                                  |
|  7  | 扩展        | `rg 'opencode\.' sdks/vscode/ → 零`             | VSIX 打包 ✅                                       | —                                                      | Zed toml 验证 ✅                   |
|  8  | CI/CD       | `rg 'anomalyco/opencode' .github/ → 零`         | —                                                  | —                                                      | CI 触发全绿 ✅                     |
|  9  | 文档/i18n   | `rg 'opencode_version' packages/web/i18n/ → 零` | `cd packages/web && astro build` ✅                | —                                                      | 20% MDX 人工抽查 ✅                |

### 2.3 门控脚本入口

```bash
# 运行 Issue N 的所有门控 (失败则 exit non-zero)
bun run script/verify-rebrand.ts --gate N

# 运行全部 9 个 Issue 门控 + 最终验证
bun run script/verify-rebrand.ts --all
```

### 2.4 门控失败处理协议

1. **G1 (grep) 失败**: 执行 agent 必须定位遗漏的替换点, 补全替换后重新提交。不允许在排除列表外存在任何残留。
2. **G2 (编译) 失败**: 必须修复所有类型错误。疑为 rename 遗漏的, 用 `rg -i 'opencode'` 在失败包中定位。
3. **G3 (测试) 失败**: 区分两种情况:
   - 测试本身引用了旧名 → 更新测试 fixture/assertion
   - 业务代码引用旧名 → 修复业务代码
4. **G4 (特殊) 失败**: 按具体失败原因处理 (lock 文件, 双读兼容, CI 配置等)。

### 2.5 `verify-rebrand.ts` 脚本规范

该脚本由 P3 提出, 需在 P6 前实现于 `packages/octopus/script/verify-rebrand.ts`(或 `script/verify-rebrand.ts` 在根目录)。

**接口设计**:

```typescript
// CLI: bun run script/verify-rebrand.ts [--gate N|--all] [--junit <path>]

interface VerifyResult {
  gate: number // Issue number (1-9) or 0 for all
  checks: Array<{
    name: string // 检查项名称
    command: string // 执行的命令
    passed: boolean // 是否通过
    output?: string // 失败时的输出摘要
  }>
  passed: boolean // 全部通过?
  timestamp: string
}
```

---

## 3. 端到端冒烟测试

### 3.1 `rebrand-smoke.ts` 规范

该脚本在全部 9 Issue 完成后执行, 验证品牌迁移的端到端正确性。

**接口设计**:

```typescript
// CLI: bun run script/rebrand-smoke.ts [--ci] [--junit <path>]

interface SmokeResult {
  suite: string // "rebrand-smoke"
  checks: Array<{
    name: string // 检查项名称
    category: string // cli | config | publish | extension | typecheck | install
    passed: boolean
    detail?: string
  }>
  passed: boolean // 全部通过?
  timestamp: string
}
```

### 3.2 冒烟检查项

#### CLI 启动 (Category: cli)

|  #  | 检查项       | 命令                                                                      | 预期                                   |
| :-: | ------------ | ------------------------------------------------------------------------- | -------------------------------------- |
| SC1 | 命令名       | `./dist/octopus --version 2>&1`                                           | 输出版本号, 无 `opencode` 字符串       |
| SC2 | 帮助文本     | `./dist/octopus --help 2>&1`                                              | 显示 `octopus` 命令名, 无 `opencode`   |
| SC3 | 配置加载     | `./dist/octopus config --show 2>&1`                                       | 使用 `.octopus/octopus.jsonc` 配置     |
| SC4 | 旧 env 双读  | `OPENCODE_DB=:memory: ./dist/octopus --version 2>&1`                      | 启动成功, 可能输出 deprecation warning |
| SC5 | 新 env 优先  | `OCTOPUS_DB=:memory: OPENCODE_DB=/dev/null ./dist/octopus --version 2>&1` | 使用 `OCTOPUS_DB` 值                   |
| SC6 | migrate 命令 | `./dist/octopus migrate --dry-run 2>&1`                                   | 命令存在, 输出正确提示                 |

#### 包发布 (Category: publish)

|  #  | 检查项         | 命令                                                | 预期                        |
| :-: | -------------- | --------------------------------------------------- | --------------------------- |
| SP1 | 主包 dry-run   | `cd packages/octopus && npm publish --dry-run 2>&1` | 名称含 `@octopus-ai`        |
| SP2 | SDK dry-run    | `cd packages/sdk/js && npm publish --dry-run 2>&1`  | 名称含 `@octopus-ai/sdk`    |
| SP3 | core dry-run   | `cd packages/core && npm publish --dry-run 2>&1`    | 名称含 `@octopus-ai/core`   |
| SP4 | plugin dry-run | `cd packages/plugin && npm publish --dry-run 2>&1`  | 名称含 `@octopus-ai/plugin` |
| SP5 | app dry-run    | `cd packages/app && npm publish --dry-run 2>&1`     | 名称含 `@octopus-ai/app`    |
| SP6 | ui dry-run     | `cd packages/ui && npm publish --dry-run 2>&1`      | 名称含 `@octopus-ai/ui`     |

#### 扩展 (Category: extension)

|  #  | 检查项        | 命令                                                              | 预期                |
| :-: | ------------- | ----------------------------------------------------------------- | ------------------- |
| SE1 | VSIX 打包     | `cd sdks/vscode && bun run package 2>&1`                          | 生成 .vsix 文件成功 |
| SE2 | VSIX 内容检查 | `unzip -l sdks/vscode/*.vsix \| grep 'opencode'`                  | 零结果 (包内无旧名) |
| SE3 | Zed toml 验证 | `bunx toml-validator packages/extensions/zed/extension.toml 2>&1` | 格式正确            |

#### 依赖安装 (Category: install)

|  #  | 检查项          | 命令                                                          | 预期                  |
| :-: | --------------- | ------------------------------------------------------------- | --------------------- |
| SI1 | frozen lock     | `bun install --frozen-lockfile 2>&1`                          | 无 workspace 解析错误 |
| SI2 | 无旧 scope 解析 | `bun install --frozen-lockfile 2>&1 \| grep -i 'opencode-ai'` | 零结果                |

#### 类型检查 (Category: typecheck)

|  #  | 检查项         | 命令                       | 预期   |
| :-: | -------------- | -------------------------- | ------ |
| ST1 | 全量 typecheck | `bun turbo typecheck 2>&1` | 全通过 |

#### 构建验证 (Category: build)

|  #  | 检查项     | 命令                                        | 预期     |
| :-: | ---------- | ------------------------------------------- | -------- |
| SB1 | CLI build  | `cd packages/octopus && bun run build 2>&1` | 构建成功 |
| SB2 | 文档 build | `cd packages/web && astro build 2>&1`       | 构建成功 |
| SB3 | app build  | `cd packages/app && vite build 2>&1`        | 构建成功 |

### 3.3 冒烟测试通过标准

**硬性条件** (所有必须 Pass):

- SC1, SC2, SC3 (CLI 核心功能)
- SI1 (依赖安装)
- ST1 (类型检查)
- SB1 (CLI 构建)

**软性条件** (失败不阻断发布, 但需记录):

- SC4, SC5, SC6 (兼容性)
- SP1-SP6 (发布 dry-run)
- SE1, SE2, SE3 (扩展)
- SB2, SB3 (文档/app 构建)

---

## 4. Canary 监控方案 (P8)

### 4.1 Canary 发布策略

```
阶段            触发条件             监控时长    回滚条件
────────────────────────────────────────────────────────────
Phase 0:       CI 全绿 + 冒烟通过     —          冒烟失败
  Pre-flight
Phase 1:       GitHub Release 创建    24h        错误率 > 5%
  Canary 发布    + npm publish
Phase 2:       Phase 1 通过          48h        CLI 崩溃率 > 1%
  Stable
Phase 3:       Phase 2 通过          —          稳定
  GA
```

### 4.2 监控指标

#### CLI 核心指标 (M1)

| 指标         | 来源                                   |       告警阈值        | 严重度 |
| ------------ | -------------------------------------- | :-------------------: | :----: |
| 启动成功     | CLI exit code + version output         |      失败率 > 2%      |   P0   |
| 配置加载     | config --show 成功率                   |      失败率 > 2%      |   P0   |
| XDG 路径切换 | 新路径 `~/.config/octopus/` 创建成功率 |       失败 > 5%       |   P1   |
| 环境变量双读 | 使用旧 `OPENCODE_*` 的用户比例         | 比例 > 50% (迁移不足) |   P2   |
| Session 创建 | 用户创建新 session 成功率              |      失败率 > 3%      |   P1   |
| 崩溃率       | CLI 异常退出 (非零 exit)               |         > 1%          |   P0   |

#### 发布指标 (M2)

| 指标             | 来源                |             告警阈值              | 严重度 |
| ---------------- | ------------------- | :-------------------------------: | :----: |
| npm 下载量       | npm registry        | `@octopus-ai/*` 下载量 < 预期 50% |   P2   |
| VS Code 扩展安装 | VS Code marketplace |         安装量 = 0 (24h)          |   P1   |
| Docker pull      | Docker Hub          |         pull 量 = 0 (24h)         |   P2   |
| Homebrew 安装    | Homebrew API        |       install 量 = 0 (24h)        |   P2   |

#### 生态指标 (M3)

| 指标               | 来源                 |            告警阈值            | 严重度 |
| ------------------ | -------------------- | :----------------------------: | :----: |
| 旧仓库 issue 数    | `anomalyco/opencode` | "brand migration" 类 issue > 3 |   P1   |
| Discord 迁移反馈   | Discord #feedback    |        负面反馈 > 5 条         |   P1   |
| GitHub Discussions | New repo discussions |        迁移问题 > 3 条         |   P2   |

### 4.3 Canary 验证脚本 (Go/No-Go 检查)

```bash
# P8 Go/No-Go 检查清单 (由 qa agent 执行)
# 全部通过 → Go; 任何 P0 失败 → No-Go

# === P0 门 ===
# 1. CLI 安装并启动
octopus --version

# 2. 非零用户能创建 session
octopus --headless --message "hello" --exit

# 3. 无回归崩溃
# 监控 Sentry/Datadog 错误率

# === P1 门 ===
# 4. 环境变量双读工作
OPENCODE_DB=:memory: octopus --version

# 5. 配置迁移提示输出
# 检查日志中是否有 migrate 提示

# === P2 门 ===
# 6. npm 包发布验证
npm view @octopus-ai/octopus versions
npm view @octopus-ai/sdk versions
npm view @octopus-ai/core versions

# 7. VS Code 扩展发布验证
# 检查 VS Code marketplace 中有新扩展
```

### 4.4 灰度监控仪表盘

**所需数据源**:

- CLI 遥测 (启动事件 + 版本号 + env 使用情况)
- npm 下载统计 (`npm view @octopus-ai/*`)
- VS Code 扩展 marketplace 统计
- GitHub Release 页面

**关键展示**:

```
┌─────────────────────────────────────────────────────┐
│  OpenCode → Octopus 迁移 Canary 仪表盘              │
├───────────────┬──────────┬──────────┬───────────────┤
│ 指标           │ 当前值   │ 阈值     │ 状态           │
├───────────────┼──────────┼──────────┼───────────────┤
│ CLI 启动成功率 │ 99.8%    │ >98%     │ ✅             │
│ 错误率         │ 0.5%     │ <2%      │ ✅             │
│ 旧 env 使用率  │ 35%      │ <50%     │ ⚠️ 注意        │
│ npm 下载量     │ 1,200    │ >500     │ ✅             │
└───────────────┴──────────┴──────────┴───────────────┘
```

---

## 5. 回归风险区域

### 5.1 直接受 rename 影响的测试文件

| 风险等级 | 文件/区域                                              | 受影响原因                                              | 检测方法              |
| :------: | ------------------------------------------------------ | ------------------------------------------------------- | --------------------- |
|  **P0**  | `packages/octopus/test/fixture/fixture.ts`             | import `@opencode-ai/core` + 引用 `opencode-test-` 前缀 | grep + typecheck      |
|  **P0**  | `packages/octopus/test/lib/effect.ts`                  | Service tag `@opencode/Foo`                             | typecheck             |
|  **P0**  | `packages/octopus/test/lib/llm-server.ts`              | import 路径                                             | typecheck             |
|  **P0**  | `packages/octopus/test/lib/websocket.ts`               | import 路径                                             | typecheck             |
|  **P0**  | `packages/octopus/test/preload.ts`                     | import 路径                                             | typecheck             |
|  **P1**  | `packages/core/test/global.test.ts`                    | 测试 `app = "opencode"` / XDG 路径                      | typecheck + test fail |
|  **P1**  | `packages/core/test/npm-config.test.ts`                | import `@opencode-ai/`                                  | typecheck             |
|  **P1**  | `packages/core/test/npm.test.ts`                       | import scope                                            | typecheck             |
|  **P1**  | `packages/app/e2e/todo.spec.ts`                        | 可能引用 `opencode` URL                                 | grep                  |
|  **P2**  | 所有 Effect service tag strings                        | `@opencode/Foo` / `@opencode/Bar` 等约 30+ 处           | typecheck             |
|  **P2**  | `packages/octopus/test/storage/db.test.ts`             | XDG 路径 `~/.local/share/opencode/`                     | test fail             |
|  **P2**  | `packages/octopus/test/storage/storage.test.ts`        | XDG 路径                                                | test fail             |
|  **P2**  | `packages/octopus/test/project/project.test.ts`        | `.opencode/` 配置路径                                   | test fail             |
|  **P2**  | `packages/octopus/test/project/migrate-global.test.ts` | XDG 路径                                                | test fail             |
|  **P2**  | `packages/octopus/test/config/*`                       | `opencode.jsonc`                                        | test fail             |
|  **P3**  | `packages/octopus/test/cli/error.test.ts`              | CLI 输出文本含 `opencode`                               | 需要断言更新          |
|  **P3**  | `packages/octopus/test/cli/import.test.ts`             | import 路径                                             | typecheck             |
|  **P3**  | `packages/octopus/test/shell/shell.test.ts`            | `opencode` 命令路径                                     | test fail             |
|  **P3**  | `packages/octopus/test/auth/auth.test.ts`              | 环境变量名                                              | test fail             |

### 5.2 CI 回归风险

| 风险等级 | 文件/区域                              | 受影响原因                                      | 检测方法         |
| :------: | -------------------------------------- | ----------------------------------------------- | ---------------- |
|  **P0**  | `.github/workflows/test.yml`           | env `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER` | CI 红            |
|  **P0**  | `.github/actions/setup-bun/action.yml` | 无直接引用, 但依赖 lock 文件                    | CI 红            |
|  **P1**  | `.github/workflows/opencode.yml`       | 文件名 + 内部引用                               | 重命名后触发失败 |
|  **P1**  | `.github/workflows/publish.yml`        | `anomalyco/opencode` 引用                       | CI 红            |
|  **P1**  | `.github/workflows/stats.yml`          | `anomalyco/opencode` 引用                       | CI 红            |
|  **P1**  | `sst.config.ts`                        | `name: "opencode"`                              | 部署失败         |

### 5.3 间接回归 (不影响编译, 但影响运行时行为)

| 风险等级 | 区域                                                                | 风险描述                                                  | 检测方法                |
| :------: | ------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------- |
|  **P1**  | XDG 数据目录 `~/.local/share/opencode/` → `~/.local/share/octopus/` | 已有 session 不可见                                       | 整合测试 + migrate 命令 |
|  **P1**  | XDG 配置目录 `~/.config/opencode/` → `~/.config/octopus/`           | 已有配置不可见                                            | 整合测试 + migrate 命令 |
|  **P1**  | 环境变量 `OPENCODE_DB` → `OCTOPUS_DB`                               | 用户 .env / CI secrets 失效                               | 双读兼容测试            |
|  **P2**  | 插件路径 `/opencode/` → `/octopus/`                                 | 已安装插件找不到                                          | e2e 测试                |
|  **P2**  | VS Code 命令 ID `opencode.*` → `octopus.*`                          | 用户快捷键失效                                            | 文档通知, 无自动检测    |
|  **P2**  | npm `@opencode-ai/*` → `@octopus-ai/*`                              | CI 中 `workspace:*` 引用自动更新, 但第三方消费者 Breaking | deprecation notice      |
|  **P3**  | 日志文件名 `opencode.log` → `octopus.log`                           | 用户日志采集脚本失效                                      | 文档通知                |

### 5.4 回归检测策略

#### 检测方式优先级

1. **编译器捕获**: `bun turbo typecheck` — 自动检测所有 import/export 路径不匹配, Service tag 变更
2. **测试失败**: `bun turbo test:ci` — 自动检测所有测试中的断言/路径/env 引用不匹配
3. **grep 静态扫描**: `script/verify-rebrand.ts` — 捕获编译器/测试无法覆盖的残留 (如文档、YAML、Markdown)
4. **人工审查**: 对测试 fixture 中的硬编码字符串、快照文件进行抽查

#### 测试修复策略

| 模式                         | 修复方式         | 示例                           |
| ---------------------------- | ---------------- | ------------------------------ |
| import from `@opencode-ai/*` | 批量 sed 替换    | `s/@opencode-ai/@octopus-ai/g` |
| Service tag `@opencode/Name` | 类型检查自动暴露 | 逐个更新 tag 字符串            |
| 测试断言中的 `opencode` 文本 | test fail 暴露   | 更新 expected 字符串           |
| fixture 路径 `.opencode/`    | grep + 手动修复  | 更新 fixture 创建逻辑          |
| XDG 路径断言                 | test fail 暴露   | 更新 expected 路径             |
| env var 名称 `OPENCODE_*`    | grep + typecheck | 批量替换 + 双读兼容            |

### 5.5 回归阻断清单

在 P7 质量门执行前, 必须验证以下内容无回归:

```
□ packages/octopus/test/ 下所有 .test.ts 文件无 opencode 旧名引用
□ packages/core/test/ 下所有 .test.ts 文件无 opencode 旧名引用
□ packages/app/test/ 下所有测试无 opencode 旧名引用
□ packages/sdk/js/ 下所有测试通过
□ packages/plugin/ 下所有测试通过
□ packages/extensions/zed/extension.toml 无旧名
□ sdks/vscode/package.json 无旧名
□ .github/workflows/*.yml 无 anomalyco/opencode (保留项除外)
□ .github/actions/*/action.yml 无 opencode 旧名
□ sst.config.ts `name` = "octopus" (不是 "opencode")
□ packages/*/package.json `name` 字段全部为 `@octopus-ai/*` 或 `@octopus-ai/octopus`
```

---

## 6. 验证脚本实现规划

### 6.1 脚本清单

| 脚本                   | 位置                                           | 用途                  | 实现优先级 | 依赖             |
| ---------------------- | ---------------------------------------------- | --------------------- | :--------: | ---------------- |
| `verify-rebrand.ts`    | `packages/octopus/script/verify-rebrand.ts`    | Issue 级门控验证 (L0) |   P6 前    | bun              |
| `rebrand-smoke.ts`     | `packages/octopus/script/rebrand-smoke.ts`     | 端到端冒烟测试 (L4)   |   P6 前    | bun + build 产物 |
| `rebrand-migration.ts` | `packages/octopus/script/rebrand-migration.ts` | 兼容迁移逻辑 (compat) |  P5 详设   | bun              |

### 6.2 verify-rebrand.ts 设计

```typescript
// 位置: packages/octopus/script/verify-rebrand.ts
// 运行: bun run script/verify-rebrand.ts [--gate N|--all] [--junit path]

// 核心逻辑: 按 Issue 分组执行 grep/fs 检查
// 输出: JUnit XML (可选) + stdout summary

// 内核示例:
const issueGates = {
  1: [
    { name: "npm scope in TS/JSON", cmd: "rg '@opencode-ai' --type ts --type json", expectEmpty: true },
    { name: "bun install frozen", cmd: "bun install --frozen-lockfile", expectExit: 0 },
  ],
  2: [{ name: "old dir gone", cmd: "test ! -d packages/opencode", expectExit: 0 }],
  // ... 详见 2.2 门矩阵
  9: [{ name: "i18n keys", cmd: "rg 'opencode_version|opencode_name' packages/web/src/i18n/", expectEmpty: true }],
}
```

### 6.3 rebrand-smoke.ts 设计

```typescript
// 位置: packages/octopus/script/rebrand-smoke.ts
// 运行: bun run script/rebrand-smoke.ts [--ci] [--junit path]

// 核心逻辑: 顺序执行冒烟检查项 (3.2 清单)
// CI 模式下 --ci: 硬性条件失败 → exit 1; 软性条件失败 → exit 0 + WARNING
// 非 CI 模式: 全部失败 → exit 1

// 输出: stdout summary table + JUnit XML (可选)
```

### 6.4 开发时序

```
P5 (本设计): 脚本接口定义 + 检查项清单
P6 (实现):
  1. 实现 verify-rebrand.ts (全部 9 Issue 门控)
  2. 实现 rebrand-smoke.ts (全部 27 检查项)
  3. 将 verify-rebrand 接入 CI (作为 Group 门)
P7 (验证):
  1. 在干净分支上运行 verify-rebrand --all → 预期大量失败 (迁移未开始)
  2. 逐 Issue 实现, 逐 Issue 验证门控转绿
  3. 全部绿后运行 rebrand-smoke
P8 (执行):
  1. CI 集成 verify-rebrand 到 publish workflow
  2. Canary 监控仪表盘
```

---

## 7. 质量门报告模板

### 7.1 Issue 完成报告模板

```markdown
# Quality Gate Report — Issue N: <标题>

**Agent**: <agent-name>
**Date**: <yyyy-mm-dd>
**Duration**: <duration>

## Gates

| Gate | Check          | Result  | Detail       |
| :--: | -------------- | :-----: | ------------ |
|  G1  | <grep command> | ✅ PASS | 0 matches    |
|  G2  | <typecheck>    | ✅ PASS | 0 errors     |
|  G3  | <test>         | ✅ PASS | 42/42 passed |
|  G4  | <special>      | ✅ PASS | —            |

## Artifacts

- <link to CI run>
- <link to test report>

## Sign-off

□ Agent complete
□ Peer review complete
□ QA approve (质量否决权)
```

### 7.2 最终质量门报告模板

```markdown
# Quality Gate Report — OpenCode→Octopus Rebrand v0.1.0

**QA**: <qa-agent-name>
**Date**: <yyyy-mm-dd>
**Version**: v0.1.0

## Summary

| Dimension         |         Result          |
| ----------------- | :---------------------: |
| All 9 Issue gates |       ✅ 9/9 PASS       |
| Grep static scan  | ✅ 0 old-name residues  |
| Full typecheck    |       ✅ 0 errors       |
| Full unit tests   |      ✅ N/N passed      |
| HttpApi exerciser | ✅ coverage/auth/effect |
| E2E Playwright    |    ✅ linux/windows     |
| Rebrand smoke     |      ✅ N/N passed      |

## Issue Gate Details

| Issue | Agent       | G1  | G2  | G3  | G4  | Overall |
| :---: | ----------- | :-: | :-: | :-: | :-: | :-----: |
|   1   | core-dev    | ✅  | ✅  | ✅  | ✅  |   ✅    |
|   2   | core-dev    | ✅  | ✅  |  —  | ✅  |   ✅    |
|  ...  | ...         | ✅  | ✅  | ✅  |  —  |   ✅    |
|   9   | feature-dev | ✅  | ✅  | ✅  | ✅  |   ✅    |

## Canary Status

| Metric          |  Status   |
| --------------- | :-------: |
| CLI start       |    ✅     |
| Error rate      | ✅ (< 2%) |
| Session create  |    ✅     |
| Config load     |    ✅     |
| npm publish     |    ✅     |
| VS Code publish |    ✅     |

## Go/No-Go Decision

**Decision**: ✅ **Go** (release-approved)

QA Signature: <qa-agent-name>
```

---

## 附录 A: 排除清单 (所有 Issue 不得修改)

```
# 第三方 npm 包
@gitlab/opencode-gitlab-auth
opencode-gitlab-auth
opencode-poe-auth

# LLM Model ID (外部模型路由)
opencode-go/deepseek-v4-pro
opencode/claude-opus-4-7
opencode/gpt-5.*
opencode/kimi-k2.*

# 外部服务 URL
https://opencode.ai/install
https://discord.gg/opencode
https://opencode.ai/docs (temporary, until octopus docs exist)

# 第三方库前缀
@opentui/*
OTEL_*
@openauthjs/*
```

## 附录 B: 快速参考命令

```bash
# 单 Issue 门控
bun run script/verify-rebrand.ts --gate 1

# 全部门控
bun run script/verify-rebrand.ts --all

# 冒烟测试
bun run script/rebrand-smoke.ts

# 全量测试 (G3 级)
bun turbo test:ci

# 全量类型检查
bun turbo typecheck

# HttpApi 门
cd packages/opencode && bun run test:httpapi

# 综合残留扫描
rg -i 'opencode' packages/ --type ts --type json --type yaml --type md | grep -v -f .octopus/design/rebrand-exclude-list.txt
```
