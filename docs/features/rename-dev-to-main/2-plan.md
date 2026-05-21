---
feat-id: rename-dev-to-main
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# rename-dev-to-main — 2-plan

## 实施步骤(2 阶段)

### Phase A:文档级改动(本 feat 主体)

`feat/rename-dev-to-main` 分支上 commit 所有文档 + workflow yml 改动,但**不**真改 git 分支结构。

| 文件 | 改动要点 |
|---|---|
| `CLAUDE.md` | 三铁律 dev → main / 默认分支段重写 / "tauri dev mode"消歧 / 健康指标 `main..upstream/dev` |
| `AGENTS.md` | line 3-4 default branch + diff ref |
| `docs/governance/fork-跟随升级与协作规范.md` | R5 feat 生命周期 + 健康指标 + SOP 命令 |
| `docs/governance/UPSTREAM-MERGE-GUIDE.md` | rebase / merge 流程命令 + push 命令 + abort 恢复段 |
| `docs/governance/双端协作-SOP.md` | 50 处 dev token 系统性替换(replace_all 批量 + 个别精修)|
| `docs/PLANNING-OVERVIEW.md` | rebase upstream 命令示例 |
| `docs/features/INDEX.md` | 顶部加"主分支命名空间"小节,显式区分 `main` 分支 vs `dev` channel |
| `.github/workflows/release-mirror-gitee-deskfox.yml` | `TARGET_BRANCH: dev` → `main` |
| `改动日志.md` | 索引行追加 |

### Phase B:实际 git 操作(等 user 二次授权)

Phase A 文档合 main 后,再做实际分支重命名:

```bash
# 1. 本地重命名
git branch -m dev main

# 2. push 新分支
git push origin -u main

# 3. GitHub 改 default branch(需 gh CLI 或 web UI)
gh repo edit --default-branch main

# 4. 删远端 dev
git push origin --delete dev

# 5. 重置本地 upstream tracking(其他活跃 feat 分支:
#    `feat/e2e-real-tauri-webdriver` / `upstream-pr/*`,根据需要)
```

Gitee 镜像同操作:

```bash
git push gitee main
# Gitee Settings → 默认分支 → main
git push gitee --delete dev
```

## 决策轨迹

### 4 选项对比 → 选 1(只改主分支)

User 给 4 个候选:
- **1. 只改主分支 `dev` → `main`** ← 采用
- 2. 只改 installer env `dev` → `preview` — 否决:已落地的 B2 后缀刚 commit,不浪费;且 "Preview" 翻译"预览版"反而绕
- 3. 都改 — 否决:破坏性最大,且不解决根本(B2 命名也得改)
- 4. 都不改,只对外文案统一 — 否决:歧义没消,治标不治本

### 替换 pattern 精确化

`双端协作-SOP.md` 50 处 dev 引用,如果做单字符全文 replace 会误伤 `upstream/dev` / `env=dev` / `-dev` 后缀。改成精确 pattern replace_all:

| 替换 pattern | 含义 |
|---|---|
| `合 dev` → `合 main` | 合并目标 |
| `git checkout dev` → `git checkout main` | 切分支命令 |
| `git pull origin dev` → `git pull origin main` | pull 命令 |
| `git push origin dev` → `git push origin main` | push 命令 |
| `origin/dev` → `origin/main` | 远端引用(注意不动 `upstream/dev`)|
| `从最新 dev` → `从最新 main` | 创建分支语境 |
| `跟上 dev` → `跟上 main` | rebase 语境 |
| `直推 dev` → `直推 main` | push 决策语境 |
| `push dev` → `push main` | push 简称 |
| `dev 上`(多种后缀)→ `main 上` | 操作目标语境 |
| `dev 切分支` / `dev 最新基线` / `dev 历史拓扑` / etc | 特定短语 |

替换后 grep 验证仅剩 `upstream/dev` + historical references + `env=dev` 代号,正确保留。

### 历史 changelog 不回填的依据

历史 `docs/features/*/3-changelog.md` 描述当时事实(2026-05-21 前主分支叫 dev),这是事实快照。改了反而失真。`INDEX.md` 顶部加注让读者懂"dev 字眼 = 当前 main"即可。

### 上游 workflows 不动的依据

`.github/workflows/typecheck.yml` / `storybook.yml` 等 upstream yml `branches: [dev]` 触发,但我们 fork:
- 不主动用这些 CI(我们的 fork-only `*-deskfox.yml` 走 tag / release publish 触发,跟分支 push 无关)
- 动它们 = 跟上游每次 merge 冲突
- 不动 = upstream sync 0 冲突,只是 push main 不触发这些 workflow(对我们无影响)

### Phase A vs Phase B 拆分理由

实际 git rename + remote 配置(`git branch -m` + `git push origin -u main` + `gh repo edit --default-branch main` + `git push origin --delete dev`)是**破坏性远端操作**,按铁律需要 user 明确授权。

Phase A 只改文档(无破坏),Phase B 实际操作(需 user 再次拍板)— 分开做让 user 有机会复审 Phase A 内容再决定是否执行 B。

## 后续 follow-up

- **Mac 端 git remote sync**:user Mac 上 `git checkout dev` 会失败,需要 `git fetch origin && git checkout main` 切换
- **gitee 镜像**:Phase B 包含 gitee 同步,但 Gitee 后台 daily 镜像 GitHub 也会自动同步主分支,需要确认 Gitee 默认分支跟随更新
- **本地 user 操作习惯**:Claude 在 CLAUDE.md 指导下后续 SOP 全用 `main`,user 如果手动操作要从 `git checkout dev` 换成 `git checkout main`
