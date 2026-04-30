---
feat-id: 规范-v2
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 规范 v2 — changelog

**关联 commit**: `1b669abd2`
**所在分支**: `feat/editable-file-viewer`
**baseline tag**: 沿用线
**触发原因**: GetBot 接入过程暴露 v1 规范痛点(详见 1-spec.md "触发原因"段)

## 实际改动

- `.husky/pre-commit`:
  - THRESHOLD 200 → 500(规范 v2 调整理由 inline 注释)
  - 加 `EXCEPTION_REGEX` 豁免 `packages/ui/src/components/provider-icons/(sprite\.svg|types\.ts)`
- `CLAUDE.md`:
  - "完整文档链路"段重写,加三文档结构 + commit message 格式 + 规模分级
  - 末尾加"规范修订记录"段(v2 / v1 时间线)
  - "改动日志"角色调整为索引表(每 feature 一行)
- 新建 `docs/features/INDEX.md`
- 新建 `docs/features/规范-v2/{1-spec,2-plan,3-changelog}.md`(本目录)
- 新建 `docs/features/getbot-接入/{1-spec,2-plan,3-changelog}.md`(从 `docs/provider-model-system.md` 迁移拆分)
- 删 `docs/provider-model-system.md`(已迁移)

## 行数

- 修改上游:`CLAUDE.md` ~50 行(新段)
- 修改 fork-only:`.husky/pre-commit` ~10 行
- 新文件 fork-only:`docs/features/**` ~400 行(spec + plan + changelog × 2 + INDEX)
- 总 staged:~460 行(<500 阈值 ✓)

## 影响范围

- ✅ 新 feature 必须用三文档结构
- ✅ pre-commit 4.2 阈值 500,sprite/types 不再误报
- ✅ commit message 必带 `[feat: <feat-id>]` tag
- ⚠️ 老 #1-#12 保留不动,**不向后兼容迁移**(查老历史去 改动日志.md,查新 feature 去 docs/features/INDEX.md)

## 回归测试点

- T1: 本笔 commit 通过 pre-commit hook(验证新阈值生效)
- T2: 后续 GetBot commit 走 [feat: getbot-接入] tag(验证新格式)
- T3: `docs/features/INDEX.md` grep 能找到本 feature

## review 自检

- [x] 仅触动 fork 白名单(`.husky/` + 根 CLAUDE.md + 根 改动日志.md + `docs/features/`)
- [x] git diff --stat 在预算内(~460 行)
- [x] 无新增依赖
- [x] 无"顺手改"未记录
- [x] baseline tag 沿用线

## 已知遗留

- `09-改动规则.md` / `12-fork-跟随升级.md` 在 opencode-plan 项目里,本笔不动(需另起 PR 同步表述)

## 回退方法

```
git revert <本笔 hash>
```
