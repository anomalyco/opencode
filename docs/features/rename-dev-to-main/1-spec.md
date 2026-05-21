---
feat-id: rename-dev-to-main
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# rename-dev-to-main — 1-spec

> 主分支 `dev` → `main` 重命名,与 installer channel `dev` 命名空间解耦

## 需求来源

2026-05-21 user 落地 `installer-version-env-suffix` 后(B2 口径:dev/beta/prod env suffix)发现命名冲突:

- 主分支 = `dev`
- Installer channel = `dev`(预览版)

两个含义共用 `dev` token 导致歧义:
- "改 dev 分支" vs "出 dev installer" — 内部协作时容易搞混
- 新人 / 外部 contributor 看 GitHub 默认分支是 `main` 普遍预期 + 工具默认对齐
- agent 指令"操作 dev"含义不明确

User 提出 4 个候选(只改主分支 / 只改 channel / 都改 / 都不改),拍板**只改主分支 `dev` → `main`**(选项 1)。

## 行业最佳实践

GitHub 默认主分支已经多年用 `main`(2020 起替代 `master`)。大厂工具:
- Chrome / Firefox / VSCode / Bun / Tauri — 主分支都叫 `main`
- 同时这些项目的 channel 名是另一维度(stable/beta/dev/canary/insiders)

DeskFox 当前 `dev` 是 fork 自 sst/opencode 的命名残留。CLAUDE.md 已明确"不自动跟随 upstream/dev,合上游是主动决策" — 所以"主分支跟上游同名"已无实际意义。

## 验收标准

| ID | 验证 | 期望 |
|---|---|---|
| A1 | `git remote show origin` | HEAD 指 `main` |
| A2 | `git branch` 本地 | 有 `main`,无 `dev` |
| A3 | GitHub 仓库 Settings → Branches | default branch = `main` |
| A4 | CLAUDE.md / AGENTS.md / governance 三件套 | "主分支 dev"全改为"main",特别保留 `upstream/dev`(上游主分支)|
| A5 | `release-mirror-gitee-deskfox.yml` `TARGET_BRANCH` | `main` |
| A6 | 现有 PR / Issue / 历史链接 GitHub auto-redirect | dev → main 自动跳转 |
| A7 | 老 ship-* tag 仍能找到 | tag 不动,只是分支名变 |
| A8 | installer env 代号 dev/beta/prod | **不动**(env channel 维度,跟分支无关)|

## 架构选型

### 命名空间清晰分离

| 命名空间 | token | 含义 |
|---|---|---|
| Git 分支 | `main` | 本仓主分支(原 `dev`)|
| Git 分支 | `feat/<name>` | feat 分支 |
| Git 分支 | `upstream/dev` | 上游 sst/opencode 主分支 |
| Installer channel | `prod` | 稳定版 |
| Installer channel | `beta` | 测试版(储备)|
| Installer channel | `dev` | 预览版(可对外发)|

**两个命名空间彻底不撞**:`main` 是分支维度,`dev`(channel)是 installer 维度。

### 改动范围

**改**(active 文件):
- `CLAUDE.md`(agent 主指令)
- `AGENTS.md`(agent 风格指南)
- `docs/governance/fork-跟随升级与协作规范.md`(治理总纲)
- `docs/governance/UPSTREAM-MERGE-GUIDE.md`(上游 merge SOP)
- `docs/governance/双端协作-SOP.md`(分支生命周期 SOP)
- `docs/PLANNING-OVERVIEW.md`(项目概览)
- `docs/features/INDEX.md`(feature 索引,加命名空间说明)
- `.github/workflows/release-mirror-gitee-deskfox.yml`(`TARGET_BRANCH: dev` → `main`)
- `改动日志.md`(加索引行)

**不改**(冻结):
- 所有 `docs/features/*/3-changelog.md`(历史 feat changelog 是当时事实快照)
- `docs/features/分支策略-v2/*`(原 v2 spec 当时叫 dev)
- `docs/history/*`(历史档案)
- Upstream workflow yml 文件(`typecheck.yml` / `storybook.yml` / `containers.yml` 等触发 `branches: [dev]` — 不主动用,不动避免 upstream merge 冲突)
- `release-deskfox.yml` 行 167 `'dev' {'-Dev'}` — installer env 代号,不动
- `release-deskfox.yml` 行 44/47 commented-out `default: 'dev'` — workflow_dispatch 默认 env,不动

## R 合规预判

- **R2** 文档级改动,无 FORK marker 需求(governance docs 是 fork 自加文件,本身就是 fork-only)
- **R3** 不涉及品牌/主题/icon
- **R4** 0 override(全 fork 白名单 + workflow yml 是 fork-only `*-deskfox.yml`)
- **R5** 治理类 feat,无代码改动,豁免 unit test(Tiny+ 文档治理)
- **R6** 不涉及网络监听

## 风险

- **外部链接失效**:`github.com/zoulukuang/deskfox/tree/dev` URL 自动 redirect 到 main(GitHub 内置)。已 ship 文档若 hardcode `/tree/dev` 会跳转,深度链接(具体行号)某些情况可能失效
- **upstream 同步**:`upstream/dev` 仍是上游主分支名,本仓主分支改 main 后,merge SOP 命令从 `git checkout dev` 改成 `git checkout main`(已更新)
- **CI 重新触发**:GitHub workflows `branches: [dev]` 触发的 push CI 会停止 — 已审,本仓 fork-only workflows 不依赖分支 push(全靠 tag 或 release publish event),upstream workflows 我们本不主动用
