---
feat-id: installer-naming-cleanup
status: done
related: ./3-changelog.md
---

# installer-naming-cleanup — changelog

**关联 commit**: `<本笔 commit>`
**所在分支**: `feat/installer-naming-cleanup`
**规模**: Tiny(~30 行 / 2 文件,仅 3-changelog 省 1-spec / 2-plan)
**触发**: 2026-05-21 user 拿到第一个 Tier 2 预览版 installer `DeskFox-Dev-2026.5.21.1-dev-setup.exe`,反馈双重 `-dev` 冗余 → 4 候选 ABCD 中拍板 B(保留 `-setup` 但去重 `-dev`)

## 根因

`installer-version-env-suffix` feat 落地 B2 后,`AppVersion` 字符串含 env suffix(`2026.5.21.1-dev`),但 `OutputBaseFilename` 模板沿用 `{#OutputBase}-{#AppVersion}-setup`,且 `OutputBase` 三档已经标了 env(`DeskFox-Dev`)→ 撞两次后缀:

- 旧:`DeskFox-Dev-2026.5.21.1-dev-setup.exe`(双重 `-dev`)
- 期望:`DeskFox-Dev-2026.5.21.1-setup.exe`(env 只通过 OutputBase 前缀体现)

## 修法

`DeskFox.iss` `OutputBaseFilename` 模板把 `{#AppVersion}` 换成 `{#NumericAppVersion}`(strip env suffix 的纯数字版本号,本来就为 `VersionInfoVersion` 准备的,复用)。

```diff
- OutputBaseFilename={#OutputBase}-{#AppVersion}-setup
+ OutputBaseFilename={#OutputBase}-{#NumericAppVersion}-setup
```

## 实际改动

| 文件 | 改动 |
|---|---|
| `packages/branding/installer/DeskFox.iss` | `OutputBaseFilename` 模板替换 + 6 行 FORK 头注解释冗余问题 |
| `docs/governance/版本号与发布渠道规范.md` | 新增 §3.4 文件名命名规则段(命名表 + 设计原理)+ 改 4 处旧示例(§四 Tier 1/2 表 + §五 SOP gh release create 命令)|

## 行数

| 项 | 行数 |
|---|---|
| `.iss` insertions / deletions | +6 / -1 |
| 治理 doc insertions / deletions | +18 / -4 |
| **净** | **+24 / -5 = 19 净** |

## 命名规则(以 2026.5.21.1 为例)

| Tier | OutputBase | NumericAppVersion | 产物文件名 |
|---|---|---|---|
| 1 prod | `DeskFox` | `2026.5.21.1` | `DeskFox-2026.5.21.1-setup.exe` |
| 2 dev | `DeskFox-Dev` | `2026.5.21.1`(strip `-dev`)| `DeskFox-Dev-2026.5.21.1-setup.exe` |
| beta(储备)| `DeskFox-Beta` | `2026.5.21.1`(strip `-beta`)| `DeskFox-Beta-2026.5.21.1-setup.exe` |
| 3 raw exe | — | — | `DeskFox.exe`(不打包)|

**Tier 1 文件名完全不变**(prod AppVersion 本就无后缀,NumericAppVersion == AppVersion)→ 历史一致。

## 4 候选 ABCD 决策

| 方案 | OutputBaseFilename | Tier 2 产物 | user 拍板 |
|---|---|---|---|
| A 全去 `-setup` + 去重 `-dev` | `{Base}-{NumericVer}` | `DeskFox-Dev-2026.5.21.1.exe` | 否决(`-setup` 是业界惯例,user 一眼识别 installer)|
| **B 保留 `-setup` + 去重 `-dev`** | `{Base}-{NumericVer}-setup` | `DeskFox-Dev-2026.5.21.1-setup.exe` | **✓ 采用** |
| C 现状(双重 `-dev`)| `{Base}-{AppVersion}-setup` | `DeskFox-Dev-2026.5.21.1-dev-setup.exe` | 否决(冗余)|
| D 全去 `-setup` + 保留 `-dev` | `{Base}-{AppVersion}` | `DeskFox-Dev-2026.5.21.1-dev.exe` | 否决(同时丢两个有用 marker)|

## 验证

| 项 | 结果 |
|---|---|
| `.iss` 改动 syntax | ISCC compile 时验证(下次 pack)|
| 治理 doc 命名表准确 | ✓(已对齐 .iss 实际行为)|
| Tier 1 历史一致性 | ✓(prod 产物名完全不变)|
| typecheck | 无代码改动,跳过 |
| 实际重打验证 | 待 merge 后跑一次 pack `-Env dev`,确认 Output 文件名变 `DeskFox-Dev-2026.5.21.1-setup.exe` |

## R 合规

- **R2** FORK marker 已加(.iss 改动点)
- **R3** 不涉及品牌
- **R4** 0 override(`packages/branding/installer/DeskFox.iss` 在 fork 白名单)
- **R5** Tiny < 50 行,豁免测试(配置文件改动无 unit test 框架)
- **R6** 不涉及网络监听

## 回退

```
git revert <本笔 commit>
```

回退后 `OutputBaseFilename` 模板回到含 `{#AppVersion}`,Tier 2/beta 产物名又会双重后缀。Tier 1 不受影响。

## 关联

- **直接依赖**:[`installer-version-env-suffix`](../installer-version-env-suffix/3-changelog.md)(B2 env suffix + NumericAppVersion 定义)
- **基石**:[`3tier-versioning-governance`](../3tier-versioning-governance/3-changelog.md)(治理 doc 主体)
- **不影响**:已 ship 历史 Tier 1 installer 文件名(那些是 `DeskFox-<纯数字>-setup.exe`,本笔不动 prod 模板)
