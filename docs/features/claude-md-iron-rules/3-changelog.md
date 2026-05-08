---
feat-id: claude-md-iron-rules
status: done
related: ./3-changelog.md
---

# claude-md-iron-rules — changelog

**关联 commit**: `78e79866a`
**所在分支**: `chore/governance-2026-05-08`(已合 dev 即销毁)
**baseline**: `8f22c4a27`
**触发原因**: 2026-05-08 user 主动给 agent 立的强约束 — 之前长 session 里 agent 多次自主 ff-merge feat → dev → push origin/dev,user 后看 commit 才知道。这次给规则之前 session 里 agent 又准备自主合并,user 喊停立的三条铁律。

## 改动

### `CLAUDE.md`(+8 行)

在"默认仓库约定(分支策略 v2)"段开头加新子段 `### 🚨 三条铁律(2026-05-08 立,绝对约束)`:

1. **永不直接在 dev 上开发** — 任何代码改动必须先开 feat 分支(`feat/<name>` kebab-case),build script / 配置 / 一行 fix 都不例外
2. **所有合并到 dev 必须 user 同意** — agent 不得自动 `git merge` / `git rebase` 影响 dev 内容,先请示再执行
3. **所有 dev → 远端 push 必须 user 同意** — agent 不得自动 `git push origin dev` / `git push origin --tags`,先请示再执行

例外说明:开 feat 分支 / feat 分支内 commit / feat 分支 push origin(私有 work,不影响 dev)agent 可自主。

## 配套 memory

- `~/.claude/projects/-Volumes-ExtSSD-opencode-fork/memory/feedback_dev_branch_iron_rules.md` 也新建一份(agent 视角的 feedback 形式),MEMORY.md 加索引 `🚨 dev 分支三条铁律`

## 影响范围

- ✅ 所有 future agent session 必读必守
- ✅ session 起步先看 `git branch --show-current`:在 dev 上 → 任何代码改动前先开 feat 分支
- ❌ 不影响代码逻辑 / 用户 UI / 测试 — 纯治理文档

## 行数

| 项 | 行数 |
|---|---|
| `CLAUDE.md` insertions | +8 |
| 文档(本文件)| ~40 行 |
| memory `feedback_dev_branch_iron_rules.md` | ~25 行(项目外,不计 repo) |

Tiny 级。0 R4 / 0 黑名单 / 0 上游侵入。

## 回退方法

`git revert 78e79866a` — 删 CLAUDE.md 三铁律段。但 user 强约束意图不变,memory feedback 还在,agent 仍守规则。

## 历史

之前 fork 协作里 user 已经多次提醒"开新分支前必先 pull rebase"等规则(memory `feedback_pull_before_new_branch.md`)。这三条是更基础的"哪些 git 操作要 agent 停下问 user"边界,层级比"怎么开分支"更高,所以加在 CLAUDE.md 顶层而非细则段。
