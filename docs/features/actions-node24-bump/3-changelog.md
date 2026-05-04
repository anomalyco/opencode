---
feat-id: actions-node24-bump
status: done
related: ./3-changelog.md
---

# actions-node24-bump — Changelog

> 实施日期:2026-05-04
> Tiny chore,8 行改动 / 2 文件 / 单一主题(workflow yml actions 版本升级)— 按 v2 SOP 只写 3-changelog,省 1-spec / 2-plan。

---

## 触发原因

ship-mac-prod-2026.5.4.1 / dispatch run 的 GitHub Actions log 末尾稳定出现 deprecation 警告:

> ! Node.js 20 actions are deprecated. The following actions are running on Node.js 20 and may not work as expected: `actions/cache@v4`, `actions/checkout@v4`, `actions/upload-artifact@v4`, `softprops/action-gh-release@v2`. Actions will be forced to run with Node.js 24 by default starting **June 2nd, 2026**. Node.js 20 will be removed from the runner on **September 16th, 2026**.

GitHub 把 `node20` runtime 6 月 2 日起改成默认走 Node 24,9 月 16 日彻底移除。本笔在 deadline 前 1 个月升 actions 主版本到自带 Node 24 runtime 的版本,清掉警告 + 防 6 月 2 日后跑挂。

---

## 改动

| 文件 | 改动 |
|---|---|
| `.github/workflows/release-deskfox.yml`(Win)| 4 处 action 版本号 bump |
| `.github/workflows/release-mac-deskfox.yml`(Mac)| 4 处 action 版本号 bump |

### 4 个 actions 各自 bump

| action | from | to | 选 to 的理由 |
|---|---|---|---|
| `actions/checkout` | `@v4` | `@v5` | v5 = 仅 Node 24 升级(`runs.using: node24`,Min Runner v2.327.1);v6 还加了 "Persist creds to a separate file" 改动,本笔不需要,保守选 v5 |
| `actions/cache` | `@v4` | `@v5` | v5 = 仅 Node 24 升级;最新 major,无新行为 |
| `actions/upload-artifact` | `@v4` | `@v6` | v5 是 preliminary(Node 24 支持但默认仍 Node 20)/ **v6 默认 Node 24**(`runs.using: node24`)/ v7 加了 Direct Uploads 新可选 feature(本笔不需要,选 v6 最 minimal) |
| `softprops/action-gh-release` | `@v2` | `@v3` | v3 = 仅 Node 24 升级(release notes 明示);v2.6.2 是最后 Node 20 兼容版 |

总改动:8 行(2 文件 × 4 处),纯版本号字符串替换,**0 input/output 兼容性改动**(用法保持原样)。

---

## commit / 关联 push

| # | commit | 主题 |
|---|---|---|
| 1 | `6c7a4c490`(本笔合并前 hash,合 dev 时 merge commit 取代)| chore(workflows): bump 4 actions Node 20→24 — checkout@v5 / cache@v5 / upload-artifact@v6 / action-gh-release@v3 |
| 2 | (本笔补全)| docs + 索引 |

---

## 验证(已实测)

| 测试项 | 操作 | 结果 |
|---|---|---|
| Mac workflow_dispatch dev 模式 | `gh workflow run release-mac-deskfox.yml --ref chore/actions-node24-bump -f env=dev` | ✅ run [25296706479](https://github.com/zoulukuang/deskfox/actions/runs/25296706479) 5m37s 全 step 通过 |
| Win workflow_dispatch dev 模式 | `gh workflow run release-deskfox.yml --ref chore/actions-node24-bump -f env=dev` | ✅ run [25296707473](https://github.com/zoulukuang/deskfox/actions/runs/25296707473) 18m19s 全 step 通过 |
| Node 20 deprecation 警告 | `gh run view <run> \| grep -i Node` | ✅ **完全消失**(对比升级前 prod ship `25284065820` 仍有完整警告) |
| .dmg / .exe 产物 | artifact upload step | ✅ `deskfox-mac-dev-2026.5.4.dispatch3` + `deskfox-dev-2026.5.4.dispatch1` 都生成 |
| upload-artifact@v6 兼容性 | dispatch run | ✅ `name` / `path` / `retention-days` input 完全兼容,无 deprecation 二次警告 |
| action-gh-release@v3 | (本笔仅 dispatch dev,Release step skipped)| 待 tag 模式真 ship 时验证(下次 ship-prod-* 或 ship-mac-prod-* push 时自然过)|

---

## 影响范围

- 触动 fork-only 文件:**2 个**(两 workflow yml)
- 改上游文件:**0 个**
- 上游侵入率影响:不变

---

## 回退方法

```bash
# 整笔回滚
git revert <merge-commit-hash>
```

revert 后 actions 回到 v4/v2,Node 20 deprecation 警告恢复;6 月 2 日前可工作,之后会 forced 跑 Node 24 看 v4 是否还工作。**正常情况下不应回滚,本笔是必做的 deadline-driven 升级**。

---

## 重大经验

1. **跨 major 版本升级要查 release notes 区分"只 Node bump"vs"加新行为"**:本笔 4 个 action 各跨 1-3 major,但选目标 major 时优先选"只 Node 24 升级的最早 major"(checkout@v5 不 v6,upload-artifact@v6 不 v7),避开"新可选 feature 引入"这种潜在干扰。结论用 `gh api repos/<owner>/<action>/releases/tags/<tag>` 看每个 major 的 body 段,比 README 链接更直接。
2. **dispatch dev 双端并行验证 = 1 笔 commit 同时双端验**:本笔 push feat 分支后,`gh workflow run --ref <feat-branch> -f env=dev` 同时触发 mac + win 两端 workflow_dispatch,5-20 分钟两端结果都到位,对小改动是高 ROI 的"合 dev 前测试"机制。比 push 后 user 自己 ship 验更早暴露。
3. **GitHub-hosted runner 版本要求自动满足**:checkout@v5 / cache@v5 都标 "Min Runner v2.327.1",`windows-latest` / `macos-latest` 都自动 ≥ 这个版本,无需关心。Self-hosted runner 才需注意。
