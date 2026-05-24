---
feat-id: upstream-rename-sst-to-anomalyco
status: done
related: ./3-changelog.md
---

# upstream-rename-sst-to-anomalyco — 3-changelog

> **forward-looking docs 统一改 sst/opencode → anomalyco/opencode**(2026-05-24 user 拍板对齐),sweeping rename / 27 文件 / 净 +2 行

## 一句话

`sst/opencode` 已被 GitHub transfer 到 `anomalyco/opencode`(单向永久 redirect),user 决议:以后讲"opencode 官方/上游"一律指 anomalyco。本笔在 27 个 forward-looking docs 里把 `sst/opencode` 字面统一改 `anomalyco/opencode`,CLAUDE.md 加 1 行历史注解释 rename;历史 archive / 旧 feat changelog / `docs/STATUS.md` / `改动日志.md` / `docs/installer-versions.md` 保留原 `sst/opencode` 字眼作为历史快照不动。

## 起源

2026-05-24 user 问"上游那 2 个 PR 反馈",Claude 查 `gh pr view 25559/25560 --repo anomalyco/opencode` 给简报,user 反问"我们当前 fork 的上游不是 opencode 官方吗?",Claude 一开始误判"二级 fork 关系",后跑 `gh api repos/sst/opencode --jq '.full_name'` 返回 `anomalyco/opencode` 才发现 sst 已 transfer 到 anomalyco。

user 拍板:"以后 anomalyco/opencode 就是 opencode 官方,我们都跟它打交道",并要求"包括相关文件说明"统一改名。

## 改动清单(27 文件 / 净 +2 行)

### Forward-looking 治理 / 用户对外 / 配置(全替换)

| 文件 | 处数 |
|---|---|
| `CLAUDE.md` | 6 处替换 + 1 行历史注(2 行 diff)|
| `AGENTS.md` | 1 |
| `docs/governance/fork-跟随升级与协作规范.md` | 4 |
| `docs/governance/UPSTREAM-MERGE-GUIDE.md` | 4 |
| `docs/governance/改动规则.md` | 1 |
| `docs/governance/双端协作-SOP.md` | 1 |
| `docs/governance/跨平台协作.md` | 3 |
| `docs/governance/版本号与发布渠道规范.md` | 2 |
| `docs/governance/应用身份-命名规则.md` | 2 |
| `docs/governance/DeskFox-品牌替换.md` | 2 |
| `docs/README.md` | 4 |
| `docs/PLANNING-OVERVIEW.md` | 2 |
| `docs/features/INDEX.md` | 2 |
| `README.md` | 6 |
| `README.zh.md` | 6 |
| `docs/legal/PRIVACY.md` | 9 |
| `docs/legal/隐私协议.md` | 9 |
| `packages/branding/{package.json,README.md}` | 2 |
| `packages/branding/src/{theme.css,logo.tsx}` | 2(注释)|
| `packages/adapter-feishu-lark/{package.json,README.md}` | 2 |
| `packages/app/e2e/README.md` | 1 |
| `packages/app/scripts/dump-sample-docx.ts` | 1(sample md 外链)|
| `.gitattributes` | 1 |

**合计:~68 处替换 + 1 行历史注**(原计划含 `.github/workflows/docs-update.yml` 2 处但撞 R4 黑名单,撤回 — 详保留段)

### Memory 同步(`~/.claude/projects/D--project-opencode-fork/memory/`)

- **新建** `reference_upstream_opencode_owner.md`:opencode 官方上游 = anomalyco/opencode 的 reference memory(防未来 agent 再犯"二级 fork"错)
- **MEMORY.md 索引**加新行指向上述 memory

### 保留(不动)

- `docs/history/*`(规划-archive / 沟通记录 / changelog-pre-v2 / GitHub-Issues)— 历史 archive
- `docs/STATUS.md` — 历史 milestone 追踪
- `改动日志.md` — 历史 changelog 索引(除本 feat 索引行)
- `docs/installer-versions.md` — 历史版本说明
- `docs/features/<14 旧 feat>/{1-spec,2-plan,3-changelog}.md` — 历史 feat 快照
- `packages/opencode/src/session/prompt.ts` + `packages/opencode/test/cli/github-remote.test.ts` — 上游代码
- `packages/app/src/context/global-sync/utils.test.ts` — test 内用 `C:\Repos\sst\opencode` 作 sample path,无语义关系
- `.github/workflows/docs-update.yml` — 上游 workflow,有 `if: github.repository == 'anomalyco/opencode'` 守卫在本 fork 永不执行,改无意义且撞 R4 黑名单(本季配额 2/2 已满,不值得)

### Git remote 暂不改

本地 `upstream` 仍指 `https://github.com/sst/opencode`(GitHub 自动 redirect 到 anomalyco,效果等价 — 暂不改 remote URL,下次主动 sync upstream 时再说,见 UPSTREAM-MERGE-GUIDE)。

## 关键决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 历史 archive / 旧 feat changelog 不改 | 历史快照本来就该记当时的事实(sst/opencode 是当时的名),改了反而失真 |
| D2 | `docs/STATUS.md` / `改动日志.md` / `docs/installer-versions.md` 不改 | 同 D1,描述过去 milestone / 配置历史 / 版本注,改了失真 |
| D3 | CLAUDE.md 加 1 行历史注 | 给未来 agent 留 anchor:解释 rename + 哪些 docs 保留 sst/opencode 字眼及理由 |
| D4 | git remote URL 不改 | sst 自动 redirect 到 anomalyco,fetch 行为等价;改 URL 多此一举且回退成本高 |
| D5 | 新建 reference memory | 防止下次 user 问起时 Claude 再犯"二级 fork"误判 |

## 影响范围

- **生产 build**:0 影响(纯文档 + 注释 + package.json 描述字段)
- **typecheck**:0 影响(无 TS 引用 sst/opencode 字面)
- **e2e**:0 影响(测试 fixture 无关)
- **CI**:`docs-update.yml` 改了 2 行 — 可能影响 docs sync workflow,但本仓 cloud build 已 abandoned,workflow 实际不跑

## 回归测试

| 测试 | 结果 |
|---|---|
| `grep -r "sst/opencode" --include="*.md" --include="*.ts" --include="*.json" --include="*.tsx" --include="*.css" --include="*.yml" .` | 剩 108 处 / 39 文件,**全在保留列表内**(历史 archive + 上游代码 + test fixture + CLAUDE.md 历史注)|
| typecheck | 不必跑(纯字符串替换 in docs/注释/package metadata,0 代码逻辑改动)|

## 回退方法

`git revert <commit-hash>` 一笔回退。新建 memory 文件需手动删:`rm "C:\Users\yuexi\.claude\projects\D--project-opencode-fork\memory\reference_upstream_opencode_owner.md"` + 还原 `MEMORY.md` 索引。

## 规模 / R 标记

- **规模**:Tiny+(27 文件 / 净 +2 行,主要 1:1 文本替换)
- **R1 三级跳**:N/A(纯文档 rename)
- **R2 FORK marker**:CLAUDE.md 加历史注带 `[feat: upstream-rename-sst-to-anomalyco]` 隐含 anchor(纯文档无需 FORK marker)
- **R3 / R4 / R6 / R7**:N/A
- **R5**:测试豁免(纯文档 rename,无业务逻辑;CLAUDE.md R5 例外清单含"docs / 配置 / 品牌资源")

## 时间戳

- 立项 + 执行 + 收尾:2026-05-24 单日
