# Discovery: v0.1.0 迁移残留深度清理

## 问题陈述

v0.1.0 品牌迁移后项目中仍有 13,039 处 opencode 引用残留（1,183 文件），同时项目作为全新未发布的 fork，存在大量可精简的冗余内容。需要在 v0.2.0 做深度清理。

## 用户原始表达

> "因为octopus是全新的项目，暂未发布，是不是同时可以考虑清理一些冗余的文件或内容？"

追问确认：
- 清理方向同意 Phase A/B/C/D 四阶段
- Phase A（构建产物）已验证未被 git 追踪，无需 Issue
- 目标：让 Octopus 真正看起来像 Octopus，不留死角

## 迭代澄清记录

| 轮次 | 问题 | 回答 |
| ---- | ---- | ---- |
| 1 | 13,039 处残留是否都需要清理？ | 是，不留死角 |
| 2 | 新项目未发布，是否可删除翻译 README 等历史包袱？ | 同意，精简到中英双语 |
| 3 | 四阶段（产物清理 / 品牌资产 / 代码清洗 / 文档评估）是否合理？ | 同意 |

## 根本需求（5 Whys）

1. **表层需求**: 清理项目中残留的 opencode 引用和冗余文件
2. **Why**: v0.1.0 迁移没有覆盖所有引用，项目看起来还是 opencode
3. **Why**: 因为迁移按「文件类型」拆解 Issue，遗漏了跨包隐式引用和内容文本
4. **Why**: 项目是 fork，fork 时带了大量原项目的文档、翻译、品牌资产
5. **根本原因**: 需要在未发布窗口期内，把项目从「opencode 套个壳」变成「真正的 Octopus」

## 查重结果

| 来源 | 结果 | 判定 |
| ---- | ---- | ---- |
| `.octopus/discovery/` | 有 `2026-05-11-opencode-to-octopus-rebrand.md` | 相关但不重复（那是 v0.1.0 的迁移计划，本 doc 是后续清理） |
| CHANGELOG.md | v0.1.0 已发布，声称覆盖 ~735 文件 | 但实际仍有 1,183 文件残留 |
| GitHub Issues (open) | 无网络访问 | 无法判定 |
| GitHub Issues (closed) | 无网络访问 | 无法判定 |

**重复判定**: ☑ 全新需求（v0.1.0 的续篇，不是重复）

## 影响范围初判

### 残留统计总览

| 类别 | 文件数 | 引用数 | 说明 |
|------|:-----:|:-----:|------|
| 文档 MDX | 594 | 9,789 | `packages/web/src/content/docs/` 18 语言 |
| i18n JSON | 16 | 127 | `packages/web/src/content/i18n/` |
| TypeScript 代码 | 436 | 2,197 | `packages/` 下所有 .ts/.tsx |
| 测试文件 | 103 | 943 | `packages/` 下 `*.test.ts` |
| README | 22 | 638 | 根目录 22 个多语言 README |
| GitHub Actions | 10 | 18 | `.github/workflows/` |
| 其他 (infra/specs 等) | 2 | ~27 | infra/、specs/、sdks/ |
| **合计** | **1,183** | **13,039** | — |

### 冗余内容识别

| 类别 | 数量 | 问题 |
|------|:----:|------|
| 翻译 README | 21 个 | 新项目未发布，维护 21 种语言 README 无意义 |
| OpenCode 品牌标识 | 6 个 mark 文件 | `packages/identity/` 中是 OpenCode 的 "O" 标记，不是 Octopus |
| 旧 favicon | 19 个 | web/app/docs 三处各一套，全是 OpenCode 的 |
| 旧 logo/hero 图 | 5 个 | `packages/docs/logo/` + `packages/docs/images/` |
| 主题文件 | 1 个 | `opencode.json` 主题名未改 |
| 音效文件 | 45 个 | `packages/ui/src/assets/audio/` 的 .aac 文件 |
| 上游开发笔记 | 3 个 spec | `specs/v2/` 中的内部 todo |
| Mintlify 文档站 | 1 个包 | `packages/docs/` 23 文件，含 Mintlify LICENSE |

### 不处理的分类

| 类别 | 原因 |
|------|------|
| `packages/` 下 `.output/` / `.turbo/` / `storybook-static/` | 未被 git 追踪，仅磁盘残留，`.gitignore` 已覆盖 .turbo |
| 第三方 npm 包引用 | 上游依赖，不在本项目控制范围 |
| LLM model ID (如 `opencode/claude-opus-4-7`) | 外部服务路由标识，修改会导致调用失败 |

## Issue 拆解

### 依赖拓扑

```
Issue 1 (README 精简)     ← 完全独立
Issue 2 (品牌资产)        ← 完全独立
Issue 3 (代码清洗)        ← 完全独立
Issue 4a (英文文档清洗)   ← 完全独立
  ├── Issue 4b (翻译文档) ← 可参考 4a 的替换规则
  └── Issue 4c (i18n)    ← 完全独立
Issue 5 (CI/脚本 URL)     ← 完全独立
```

### Issue 列表

| # | Issue 标题 | 预估文件数 | 级别 | 依赖 | 可并行 |
|---|-----------|:--------:|:---:|------|:------:|
| 1 | **README 多语言精简 & 清理** | ~22 | S | — | #2, #3, #5 |
| 2 | **品牌资产替换** | ~30 | S | — | #1, #3, #5 |
| 3 | **代码 & 测试 opencode 深度清洗** | ~540 | L | — | #1, #2, #5 |
| 4a | **英文文档 opencode 清洗** | ~34 | S | — | #1, #2, #3, #5 |
| 4b | **翻译文档 opencode 清洗** (17 语言) | ~578 | L | #4a | — |
| 4c | **i18n JSON 清洗** | ~16 | XS | — | #4a, #4b |
| 5 | **CI/CD & 脚本 URL 更新** | ~20 | S | — | #1, #2, #3 |

### 可完全并行

所有 6 个 Issue 之间无代码文件交集，可以完全并行执行。

---

### Issue 1: README 多语言精简 & 清理 [S]

**描述**: 删除 20 个翻译 README，只保留中文和英文；清理保留的 README 中 opencode 引用。

**范围**:

- 删除 20 个翻译 README: `README.{ar,bn,br,bs,da,de,es,fr,gr,it,ja,ko,no,pl,ru,th,tr,uk,vi,zht}.md`
- 保留: `README.md` (英文) + `README.zh.md` (中文)
- 更新 `README.md`: 638 处 opencode 引用 → octopus（注意区分需要保留的第三方引用如 opencode 模型 ID）
- 更新 `README.zh.md` 同上

**验收标准**:

- [ ] 根目录只剩 `README.md` + `README.zh.md`
- [ ] `grep opencode README.md README.zh.md` 零保留结果（排除第三方模型 ID）
- [ ] `CONTRIBUTING.md` 中的 opencode 引用同步更新

**注意**: README 中的 `opencode` 可能出现在命令示例、环境变量名、配置路径等。需要逐处判断语义。

---

### Issue 2: 品牌资产替换 [S]

**描述**: 用 Octopus 的品牌标识替换所有 OpenCode 的视觉资产。

**范围**:

| 子任务 | 文件 | 操作 |
|--------|------|------|
| 替换 identity marks | `packages/identity/` 6 个文件 | 替换为 Octopus 品牌标识 |
| 替换 favicon | `packages/web/public/` 9 个 + `packages/app/public/` 8 个 + `packages/docs/` 2 个 | 替换为 Octopus favicon |
| 替换 docs logo | `packages/docs/logo/dark.svg` + `light.svg` | 替换为 Octopus logo |
| 替换 docs hero 图 | `packages/docs/images/hero-dark.png` + `hero-light.png` + `checks-passed.png` | 替换截图或删除 |
| 主题改名 | `packages/ui/src/theme/themes/opencode.json` | 重命名 + 更新 name 字段 → `octopus.json` |
| 主题引用 | `packages/ui/src/theme/default-themes.ts` | `opencodeTheme` → `octopusTheme` |
| CSS class | 全局 | `opencode-theme` → `octopus-theme` 等 |
| 音效评估 | `packages/ui/src/assets/audio/` 45 个 .aac | 决策是否保留（体积不大但属于原项目资产） |

**验收标准**:

- [ ] `packages/identity/mark.svg` 是 Octopus 品牌标识
- [ ] 所有 favicon 显示 Octopus 标识
- [ ] 主题 `octopus.json` 正确加载
- [ ] `grep 'opencode-theme\|opencodeTheme\|opencode-find\|opencode-line-comment' packages/ui/` 零结果
- [ ] Storybook 中主题切换正常

**前置**: 需要 Octopus 的 logo/品牌标识设计稿。如果暂无设计稿，可先用临时占位标识。

---

### Issue 3: 代码 & 测试 opencode 深度清洗 [L]

**描述**: 清理所有 `packages/` 下 TypeScript 源代码和测试文件中的 opencode 引用。

**范围**:

| 子类 | 文件数 | 引用数 | 典型内容 |
|------|:-----:|:-----:|----------|
| 源代码 .ts/.tsx | 436 | 2,197 | 日志字符串、错误消息、CLI 提示、变量名、注释 |
| 测试 .test.ts | 103 | 943 | 测试用例名、期望字符串、fixture 路径、env var 名 |
| 配置 fixture | ~20 | ~300 | `.opencode/` 路径、`opencode.jsonc` 文件名 |

**重点文件**:

- `packages/octopus/test/config/config.test.ts` — 172 处
- `packages/octopus/test/provider/provider.test.ts` — 153 处
- `packages/desktop/src/main/index.ts` — 9 处
- `packages/desktop/src/main/migrate.ts` — 9 处
- `packages/slack/src/index.ts` — 7 处
- `packages/octopus/src/index.ts` — 5 处

**改名规则**:

| 原名 | 新名 | 场景 |
|------|------|------|
| `.opencode/` | `.octopus/` | 配置目录路径 |
| `opencode.jsonc` | `octopus.jsonc` | 配置文件名 |
| `OPENCODE_*` | `OCTOPUS_*` | 环境变量名 |
| `opencode` (字符串) | `octopus` | CLI 输出、日志、错误消息 |
| `opencode` (变量名) | `octopus` | JS 标识符（如 `const opencode = ...`） |

**不修改的**:

- LLM model ID: `opencode/claude-opus-4-7`、`deepseek/deepseek-v4-pro` 等
- 第三方包名: `@gitlab/opencode-gitlab-auth`、`opencode-poe-auth` 等
- 外部 URL: `https://opencode.ai/install`（如果实际还存在）
- Discord: `discord.gg/opencode`

**验收标准**:

- [ ] `rg 'opencode' packages/ -g '*.ts' -g '*.tsx'` 零有效结果（排除上述不修改的）
- [ ] `bun turbo typecheck` 全量通过
- [ ] `bun test` in `packages/octopus` 通过（test name 中的 opencode 需同步改）

---

### Issue 4a: 英文文档 opencode 清洗 [S]

**描述**: 清理 `packages/web/src/content/docs/` 顶层 34 篇英文 MDX 文档中的 opencode 引用。

**范围**: 34 篇英文文档（cli.mdx、providers.mdx、config.mdx 等），约 2,000 处引用。

**注意**:
- 代码块中的命令示例: `opencode xxx` → `octopus xxx`
- 配置路径: `.opencode/` → `.octopus/`、`opencode.jsonc` → `octopus.jsonc`
- 品牌名文本: "OpenCode" → "Octopus"
- ⚠️ 保留外部模型 ID 不修改
- ⚠️ 保留历史/迁移说明中的 opencode 引用

**验收标准**:

- [ ] 34 篇英文文档中 `opencode` 仅出现于外部模型 ID 和历史说明
- [ ] 所有代码示例中的 CLI 命令为 `octopus`
- [ ] 所有配置路径指向 `.octopus/` 和 `octopus.jsonc`

---

### Issue 4b: 翻译文档 opencode 清洗 [L]

**描述**: 清理 17 个语言目录下的 578 篇翻译 MDX 文档（每个语言 34 篇）。

**范围**: `packages/web/src/content/docs/{ar,bs,da,de,es,fr,it,ja,ko,nb,pl,pt-br,ru,th,tr,zh-cn,zh-tw}/` 各 34 篇。

**执行策略**:

1. 先执行 Issue 4a（英文文档），确定替换规则和例外清单
2. 将替换规则批量应用到所有翻译文档（翻译文档与英文文档结构完全一致）
3. 逐语言抽查验收（每个语言抽 2-3 篇关键文档）

**验收标准**:

- [ ] 578 篇翻译文档中 `opencode` 引用全部清理（排除例外）
- [ ] 每个语言随机抽查 3 篇关键文档（cli / providers / config）通过
- [ ] 代码块中的命令为 `octopus`

**前置依赖**: Issue 4a（参考替换规则）

**建议**: 如果人力有限，可以考虑只保留中/英/日三种语言的文档，删除其余 14 个语言目录。这不是本 Issue 范围，但可作为后续精简的候选。

---

### Issue 4c: i18n JSON 清洗 [XS]

**描述**: 清理 16 个 i18n locale JSON 文件中的 opencode 引用。

**范围**: `packages/web/src/content/i18n/{en,ar,bs,da,de,es,fr,it,ja,ko,pl,pt-BR,ru,th,tr,zh}.json` 共 16 个文件，127 处引用。

**注意**:
- 翻译值中的 "OpenCode" → "Octopus"
- i18n key 如果是 `opencode_*` 前缀需改为 `octopus_*`（需同步更新前端引用）

**验收标准**:

- [ ] 16 个 i18n JSON 中 `opencode` 零结果
- [ ] 前端能正确读取更新后的 i18n key

---

### Issue 5: CI/CD & 脚本 URL 更新 [S]

**描述**: 清理 GitHub Actions、构建脚本、基础设施配置中的 opencode 引用和外部 URL。

**范围**:

| 子类 | 文件数 | 引用数 |
|------|:-----:|:-----:|
| GitHub Actions workflows | 10 | 18 |
| Container 构建脚本 | 2 | 3 |
| Infrastructure 配置 | 3 | 3 |
| VSCode 扩展 README | 1 | 7 |
| 其他 | ~3 | — |

**具体操作**:

- `.github/workflows/`: 更新 workflow 名称/步骤描述中的品牌名
- `packages/containers/script/build.ts`: Docker registry `ghcr.io/anomalyco` → 新 registry, buildx context `opencode` → `octopus`
- `packages/containers/README.md`: 同上
- `infra/*.ts`: stage/monitoring/console 配置中的品牌引用
- `sdks/vscode/README.md`: 所有 `https://opencode.ai` → 新网站, `anomalyco/opencode` → 新仓库
- `specs/v2/todo.md` / `specs/project.md`: 内部笔记中的 opencode 引用

**需要额外非代码操作**（记录但不执行）:

- GitHub Secrets 重命名: `OPENCODE_API_KEY` → `OCTOPUS_API_KEY`
- GitHub Variables: `OPENCODE_APP_ID` → `OCTOPUS_APP_ID`

**验收标准**:

- [ ] `rg 'opencode' .github/workflows/` 零结果（排除外部依赖说明）
- [ ] `rg 'anomalyco/opencode' .github/` 零结果
- [ ] `rg 'opencode.ai' sdks/vscode/` 零结果
- [ ] Container 构建脚本中的 registry/buildx 上下文正确

---

## 其他决策点

以下项目不在 Issue 拆解中，但值得在清理过程中决策：

| # | 决策项 | 当前状态 | 建议 |
|---|--------|---------|------|
| D1 | `packages/docs/` (Mintlify 文档站) | 23 文件，1 处 opencode，含 Mintlify LICENSE | 如果 Octopus 不用 Mintlify，整个删除 |
| D2 | `packages/slack/` (Slack bot) | 2 文件，7 处 opencode | Issue 3 会清理引用，但需决策是否保留此功能 |
| D3 | 翻译文档精简 | 18 语言 × 34 篇 = 612 篇 MDX | 建议只保留 en + zh + ja，其余 14 语言可删除 |
| D4 | `specs/v2/` (上游开发笔记) | 3 文件，1 处 opencode | 删除或归档到 `.octopus/archive/` |
| D5 | 音效文件 | 45 个 .aac | 评估是否 OpenCode 专有资产 |

## 建议的变更级别

**XL** — 总体超过 1,000 文件、13,000+ 引用。已拆解为 6 个 Issue（2×XS + 3×S + 2×L），最大单个 Issue 为 578 文件（L 级）。

### 并行执行建议

所有 6 个 Issue 修改的文件集完全不重叠，可以**同时并行**执行。唯一约束是 Issue 4b 建议在 4a 之后执行以复用替换规则。

```
┌─ Issue 1 (README)  ─┐
├─ Issue 2 (品牌资产) ─┤
├─ Issue 3 (代码清洗) ─┼── 全部并行
├─ Issue 4a (英文文档) ┤
├─ Issue 4c (i18n)    ─┤
├─ Issue 5 (CI/脚本)  ─┘
└─ Issue 4b (翻译文档) ← 4a 完成后启动
```

## 决策

☑ 进入 P1（创建 6 个 GitHub Issue）→ 由 orchestrator 接管后续流程
