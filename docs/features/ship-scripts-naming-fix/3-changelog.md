---
feat-id: ship-scripts-naming-fix
status: done
related: ./3-changelog.md
---

# ship-scripts-naming-fix — changelog

**关联 commit**: `<本笔 commit>`
**所在分支**: `feat/ship-scripts-naming-fix`
**规模**: Tiny+(~45 行改 / 4 脚本 / 仅 3-changelog 省 1-spec/2-plan)
**触发**: 2026-05-21 首次跑 Tier 2 预览版 ship 流程,4 个 ship 脚本发现命名 / tag 识别滞后于新规则

## 根因

`installer-naming-cleanup` 改了 `.iss` `OutputBaseFilename` 用 NumericAppVersion(strip env suffix),但相关 ship 脚本里硬编码的路径算法 / tag regex 没同步:

1. **`pack-installer.ps1` 末尾 echo path** 用 `$newVersion`(含 `-dev` 后缀)→ 报错路径不存在或显示老名 `DeskFox-Dev-...-dev-setup.exe`,但 ISCC 实际出的是新名 `DeskFox-Dev-...-setup.exe`
2. **`pack-installer.sh` .dmg rename** 用 `$NEW_VERSION`(含后缀)+ productName 含空格 → Mac dev/beta `.dmg` 文件名双重后缀 + 跨平台不一致(`DeskFox Dev-2026.5.21.1-dev_aarch64.dmg`)
3. **`mirror-asset-to-gitee.ps1` tag regex** 只认 `^ship-(prod|beta)-(.+)$` → `ship-dev-*` Tier 2 tag 不识别,asset 自动定位失败
4. **`mirror-asset-to-gitee.sh` tag regex** 同 .ps1,Mac 同 bug

## 实际改动

### `packages/branding/scripts/pack-installer.ps1`(+5 / -1)

```diff
+ $numericVersion = $newVersion -replace '-(dev|beta)$', ''
- $installerPath = Join-Path $root "installer/Output/DeskFox$envSuffix-$newVersion-setup.exe"
+ $installerPath = Join-Path $root "installer/Output/DeskFox$envSuffix-$numericVersion-setup.exe"
```

### `packages/branding/scripts/pack-installer.sh`(+9 / -2)

```diff
+ NUMERIC_VERSION=$(echo "$NEW_VERSION" | sed -E 's/-(dev|beta)$//')
+ product_part_clean="${product_part// /-}"  # 空格 → 横杠跟 Win 风格对齐
- new_name="${product_part}-${NEW_VERSION}_${arch_part}.dmg"
+ new_name="${product_part_clean}-${NUMERIC_VERSION}_${arch_part}.dmg"
```

例:Mac dev .dmg 从 `DeskFox Dev-2026.5.21.1-dev_aarch64.dmg`(双重 -dev + 含空格)→ `DeskFox-Dev-2026.5.21.1_aarch64.dmg`(命名跟 Win 一致)。

### `packages/branding/scripts/mirror-asset-to-gitee.ps1`(+13 / -8)

- tag regex `(prod|beta)` → `(prod|beta|dev)`(认 Tier 2 ship tag)
- 调整顺序:先匹配 `^ship-mac-...` 再 `^ship-...`(避免 ship-mac-dev 被 Win 匹配吞掉)
- 加 `$numericVersion = $version -replace '-(dev|beta)$', ''`
- Win asset path 用 `$numericVersion`

### `packages/branding/scripts/mirror-asset-to-gitee.sh`(+18 / -6)

- tag regex 同 .ps1 加 dev
- NUMERIC_VERSION strip 后缀
- Mac asset 自动定位(原来是 TODO,本笔顺手补齐):用 `PRODUCT_PREFIX-NumericVer_aarch64.dmg` 模板,跟 pack-installer.sh rename 后的命名对齐

## 行数

| 项 | 行数 |
|---|---|
| pack-installer.ps1 | +5 / -1 |
| pack-installer.sh | +9 / -2 |
| mirror-asset-to-gitee.ps1 | +13 / -8 |
| mirror-asset-to-gitee.sh | +18 / -6 |
| **净** | **+45 / -17 = 28 净** |

## 验证(本笔 commit 后跑一次确认)

| 项 | 命令 | 期望 |
|---|---|---|
| pack-installer.ps1 Tier 2 path echo | `pack-installer.ps1 -Env dev`(下次 ship 时验证)| 末尾 echo `DeskFox-Dev-<NumericVer>-setup.exe` 不再带 `-dev` |
| mirror-asset-to-gitee.ps1 Tier 2 tag | `mirror-asset-to-gitee.ps1 -Tag ship-dev-<NumericVer>-dev` | 不再报 "无法从 tag 推 platform/env/version" |
| Mac 端两个脚本 | 待 Mac 端实际 ship Tier 2 时验证 | — |

## 暴露但本笔不修的 follow-up

- **`release-deskfox.yml` Tier 2 自动化 workflow** 未建(`ship-dev-*` tag 自动触发 build + draft prerelease)— 单独 feat,~200 行,等需求驱动
- **`release-mirror-gitee-deskfox.yml` 复活**(目前 DISABLED,Gitee release 元数据要手动调 API 建)— 跟 GitHub publish 自动同步 Gitee 元数据,单独 feat
- **Mac 端 release-mac-deskfox.yml Tier 2 触发** — 跟 Win 同步

## R 合规

- **R2** FORK marker 已加(4 个脚本各改动点)
- **R3** 不涉及品牌
- **R4** 0 override(全 fork-only 脚本)
- **R5** Tiny+,工具脚本改动,豁免 unit test(ps1/sh 无 unit test 框架)
- **R6** 不涉及网络监听

## 回退

```
git revert <本笔 commit>
```

回退后 4 个脚本回到 installer-naming-cleanup 落地前的算法,Tier 1 prod ship 流程不受影响(prod 本就没后缀,strip 操作 no-op);Tier 2 ship 流程退回需要 `-Asset` 手动指定 + path echo 显示错误名。

## 关联

- **直接前置**:[`installer-naming-cleanup`](../installer-naming-cleanup/3-changelog.md)(`.iss` 改 NumericAppVersion,脚本本应同笔同步)
- **基础设施**:[`installer-version-env-suffix`](../installer-version-env-suffix/3-changelog.md)(B2 env suffix)
- **首次实战**:`win-ship-dev-2026.5.21.1-dev` Tier 2 ship 跑流程时暴露这些 bug
