---
feat-id: 3tier-versioning-governance
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 3tier-versioning-governance — changelog

**关联 commit**: `<本笔 commit>`
**所在分支**: `feat/3tier-versioning-governance`
**规模**: Medium(~400 行 / 8 文件 / 1 新治理 doc)
**触发**: 2026-05-21 user 落地 `installer-version-env-suffix` + `rename-dev-to-main` 后,讨论"3 种安装包如何管理 + 版本号如何定" → 拍板 3-tier 体系 + 落实文档

## 实际改动

### 🆕 `docs/governance/版本号与发布渠道规范.md`(centerpiece,+200 行)

9 段:3-tier 总览 / 命名空间分离 / 版本号规则 / 各 tier 详细规则 / 操作 SOP / 决策记录 / follow-up / 关联文档 / 修订记录

### `README.md`(+1 行净)

"Engineered packaging" 文案补 channel 语义:
```diff
- triple-env (prod / beta / dev) builds
+ triple-env (`prod` stable / `beta` reserved / `dev` preview) builds
+ See [release channel & versioning rules](docs/governance/版本号与发布渠道规范.md).
```

### `README.zh.md`(+1 行净)

同上中文版。

### `docs/governance/应用身份-命名规则.md`(+2 行)

顶部加"关联规范"行,指向新治理 doc:
```
> **关联规范**:本文规定**身份标识**(AppId / Bundle ID),发布渠道语义与版本号规则见
> [`版本号与发布渠道规范.md`](./版本号与发布渠道规范.md)(3-tier:稳定版 / 预览版 / 本地测试)。
```

### `CLAUDE.md`(+1 行)

文档链路表加新治理 doc 一行,在"应用身份命名规则"之后。

### `packages/branding/scripts/pack-installer.ps1`(+5 行)

头注加 3-tier 说明 + cross-link。

### `packages/branding/scripts/pack-installer.sh`(+5 行)

同 .ps1。

### `docs/features/INDEX.md`(+1 行)

feat 索引。

### `改动日志.md`(+1 行)

feat 索引。

## 不改的

- 历史 feat changelog(各 `docs/features/*/3-changelog.md` 提"三档"的地方不回填 channel 语义)
- `docs/history/*`(历史快照)
- `docs/features/分支策略-v2/*`(v2 spec 历史)
- `docs/governance/双端协作-SOP.md`(rename feat 已经更新,不重复)
- `bump-installer-version.{ps1,sh}` 头注(installer-version-env-suffix feat 已对齐)
- `release-deskfox.yml`(env code 处理已对齐)

## 行数

| 项 | 行数 |
|---|---|
| 新治理 doc | +200 |
| 5 处 cross-link / 文案补丁 | ~15 |
| feat 三文档 | ~250 |
| INDEX + 改动日志 | +2 |
| **总** | **~470** |

Medium 规模(50-500 行 / 单一主题),三文档全套。

## 验证

| 项 | 结果 |
|---|---|
| 治理 doc 9 段完整 | ✓ |
| 5 处 cross-link 都存在 | ✓ |
| README × 2 文案对齐 | ✓ |
| typecheck | 无代码改动,sanity 跳过 |
| Commit / 等 merge 授权 | 待 user 拍板 |

## R 合规

- **R2** 文档级,无 FORK marker 需求(治理 doc / README / 脚本头注均 fork-only 文件)
- **R3** 不涉及品牌/主题/icon
- **R4** 0 override(全 fork 白名单)
- **R5** Medium 治理 feat,无代码改动,豁免 unit test
- **R6** 不涉及网络监听

## 回退

```
git revert <本笔 commit>
```

回退后新治理 doc 删除,5 处 cross-link / 文案补丁回到改前状态。3-tier 体系不再有 written 规范(但实际 channel 机制 — AppId / B2 后缀 / pack scripts — 仍由前两笔 feat 保留)。

## 关联

- **基石依赖**:
  - [`installer-version-env-suffix`](../installer-version-env-suffix/3-changelog.md)(B2 版本号 env suffix)
  - [`rename-dev-to-main`](../rename-dev-to-main/3-changelog.md)(主分支重命名,命名空间解耦)
- **共生**:[`应用身份-命名规则.md`](../../governance/应用身份-命名规则.md)(AppId / Bundle ID 三档)
- **未做的 follow-up**:
  - Tier 2 自动化 workflow `release-deskfox-prerelease.yml`(等首次 Tier 2 ship 时补)
  - 官网"预览版"独立入口(`deskfox.ai` 改,跟仓库分离)
