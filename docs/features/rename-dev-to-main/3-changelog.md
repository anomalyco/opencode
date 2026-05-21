---
feat-id: rename-dev-to-main
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# rename-dev-to-main — changelog

**关联 commit**: `<本笔 Phase A commit>`(文档 + workflow yml)+ Phase B 实际 git 操作待 user 二次授权
**所在分支**: `feat/rename-dev-to-main`
**规模**: Tiny+(治理文档级,~150 行净改;实际 git 操作 0 代码)
**触发**: 2026-05-21 user 落地 `installer-version-env-suffix` 后(B2 dev/beta/prod env suffix)发现主分支 `dev` 与 installer channel `dev` 命名冲突,4 选项中选 1(只改主分支 dev → main)

## Phase A 实际改动(本笔 commit)

### `CLAUDE.md`

- "默认分支 `dev`" → "默认分支 `main`"
- 三铁律 "永不直接在 dev 上开发"等 → "...main 上..."
- "**🌿 开任何新分支前必先拉最新 dev**" → "...最新 main..."(SOP 命令同改)
- "**漂移 commit 数** = `dev..upstream/dev`" → "= `main..upstream/dev`(本仓 main / 上游 sst/opencode 仍 dev)"
- "改完不起 dev,直接 build release exe" → "改完不起 **tauri dev mode(`bun dev`)**,直接 build release exe"(消歧 tauri dev mode 跟分支)
- "`-Env dev|beta|prod` 三档" → "三档 installer channel(平时用 `dev` 这档,跟分支名 `main` 无关)"
- 默认仓库约定段 heading 加"主分支 dev → main,2026-05-21 起"
- 加注:历史 commit / 改动日志 / docs/history 里"dev 分支"是 2026-05-21 前称呼,语义指向当前 main,不回填

### `AGENTS.md`

```diff
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
+ The default branch in this repo is `main` (renamed from `dev` on 2026-05-21; upstream sst/opencode still uses `dev`).
+ Use `main` or `origin/main` for diffs. Upstream comparisons go against `upstream/dev`.
```

### `docs/governance/fork-跟随升级与协作规范.md`

- R5 段加注 "主分支 dev → main"
- 健康指标表 "`dev..upstream/dev`" → "`main..upstream/dev`"
- §A 季度强制对齐 SOP 命令 5 处 dev → main

### `docs/governance/UPSTREAM-MERGE-GUIDE.md`

- §4.1 rebase 命令 `git checkout dev` → `git checkout main` + 加注上游主分支仍是 dev
- §4.2 merge 命令同
- §5 abort 后回 dev → 回 main
- §6 push 命令 `git push origin dev` → `git push origin main`
- §7 故障表 "dev 分支 push 拒收" → "main 分支 push 拒收"

### `docs/governance/双端协作-SOP.md`(改动最大)

50 处 dev 引用系统性替换。pattern replace_all 批量 + 个别精修:
- `合 dev` → `合 main`(高频)
- `git checkout dev` / `git pull origin dev` / `git push origin dev` 全套命令替换
- `origin/dev` → `origin/main`(注意不动 `upstream/dev`)
- `从最新 dev` / `跟上 dev` / `直推 dev` / `dev 上...` 各种短语
- 七、命令速查表全套命令更新
- §八文档关系表加注 v2 spec 写作时主分支叫 dev,2026-05-21 起改名

### `docs/PLANNING-OVERVIEW.md`

rebase upstream 命令示例 dev → main + 上游仍 dev 注解。

### `docs/features/INDEX.md`

顶部加"主分支命名空间"小节,显式区分:
- Git 分支:`main` / `feat/<name>` / `upstream/dev`(上游)
- Installer channel:`prod` / `beta` / `dev`(预览版)
- 两个命名空间不撞

### `.github/workflows/release-mirror-gitee-deskfox.yml`

`env: TARGET_BRANCH: dev` → `main`

### `改动日志.md`

索引行追加。

## 不改的(冻结)

- 所有 `docs/features/*/3-changelog.md`(historical feat 描述)
- `docs/features/分支策略-v2/*`(v2 spec 历史快照)
- `docs/history/*`(归档)
- Upstream workflow yml(`typecheck.yml` / `storybook.yml` 等 `branches: [dev]` — 不主动用,不动避免 upstream merge 冲突)
- `release-deskfox.yml` 行 167 `'dev' {'-Dev'}`(env code,不动)
- 已 ship `ship-prod-*` tag 不动

## Phase B(实际 git 操作,待 user 二次授权)

Phase A 文档合 main 后,执行:

```bash
# 1. 本地重命名
git branch -m dev main

# 2. push 新分支
git push origin -u main

# 3. GitHub default branch 切换
gh repo edit zoulukuang/deskfox --default-branch main

# 4. 删远端 dev
git push origin --delete dev

# 5. Gitee 同步
git push gitee main
git push gitee --delete dev   # Gitee 后台 GitHub mirror 也会跟随更新默认分支
```

风险已在 1-spec.md 列出(外部链接 redirect / upstream 命令仍用 dev / CI 触发停止)。

## 行数

| 项 | 行数 |
|---|---|
| CLAUDE.md | ~15 行净改 |
| AGENTS.md | 2 行重写 |
| governance × 3 | ~30 行 |
| PLANNING + INDEX | ~15 行 |
| workflow yml | 1 行 |
| 改动日志.md | 1 行 |
| 三文档全套 | ~350 行 |
| **总 Phase A** | **~415 行(含三文档)** |

Tiny+ 范围(纯文档治理,无代码)。

## 验证

| 项 | 结果 |
|---|---|
| grep dev 残留 | 仅剩 `upstream/dev`(正确)+ historical changelog(冻结)+ env=dev 代号(正确) |
| CLAUDE.md / AGENTS.md / governance 引用一致性 | 全部主分支描述用 main ✓ |
| workflow yml syntax | yaml 单字符替换不破语法 |
| typecheck | 不涉及代码,跳过 |
| Phase A commit | 待 commit |
| Phase B 实际 git 操作 | 待 user 二次授权 |

## R 合规

- **R2** 文档级改动,无 FORK marker 需求(governance docs 本就是 fork-only 文件)
- **R3** 不涉及品牌/主题/icon
- **R4** 0 override(全 fork 白名单)
- **R5** 治理类 feat,无代码改动,豁免 unit test(Tiny+ 治理纯文档)
- **R6** 不涉及网络监听

## 回退

Phase A 回退:`git revert <本笔 commit>` — 所有文档回到改名前的措辞,workflow yml `TARGET_BRANCH` 回 `dev`。

Phase B 回退(如果已执行):
```bash
git branch -m main dev
git push origin -u dev
gh repo edit --default-branch dev
git push origin --delete main
```

## 关联

- **触发**:`installer-version-env-suffix` feat 落地后命名冲突 user 发现
- **协同**:`installer-version-env-suffix`(B2 env suffix)+ 本 feat = 完整命名空间分离设计
- **后续**:Phase B 实际操作后,Mac 端 user 需 `git fetch origin && git checkout main` 切换
- **不影响**:已 ship `ship-prod-*` tag 全部保留,release 历史不动
