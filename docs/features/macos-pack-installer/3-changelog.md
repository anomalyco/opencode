---
feat-id: macos-pack-installer
status: done
related: ./3-changelog.md
---

# macos-pack-installer — changelog

**关联 commit**: `373195692`
**所在分支**: `feat/editable-file-viewer`
**规模**: Tiny(2 新 sh ≈ 209 行 + 4 mode change + 1 行 gitignore + 文档,无 1-spec / 2-plan)
**触发原因**: `installer-versioning`(2026-04-29 done)Win 侧已落 `pack-installer.ps1` + `bump-installer-version.ps1`,macOS 侧标记"待补"。本次补全 macOS 一键打包脚本,并修复 `apply-icons.sh` 现场生成的 `icon.icns` 没进 .gitignore 导致工作树脏的小漏。

## 实际改动

### 新增文件

#### `packages/branding/scripts/pack-installer.sh`(+103)

macOS 一键打包流程,对称 `pack-installer.ps1`:

1. `bump-installer-version.sh -Platform macOS` → bump `YYYY.M.D.N` 版本号 + 在 `docs/installer-versions.md` 顶部插一条 placeholder
2. `build-deskfox.sh -Env <env>` → tauri build,产 `.app` + `.dmg`(默认 `prod` env,可 `--env beta`)
3. 列出产物路径(raw binary / `.app` / `.dmg`)+ 提示填 placeholder + macOS Gatekeeper 处理提示

可选 `--no-bump` 跳过 bump(re-pack 现有版本号,不在 changelog 留新条)。

#### `packages/branding/scripts/bump-installer-version.sh`(+106)

macOS / Linux 版的版本号 bump,对称 `bump-installer-version.ps1`:

- 规则 `YYYY.M.D.N`(年.月.日.当天第几版,N 从 1 起;**Win/Mac 各自独立 N 序列**)
- 解析 `docs/installer-versions.md` 已有 `## [Platform] YYYY.M.D.N` 取最大 N + 1
- macOS 跳过 `.iss` 更新(那是 Inno Setup 给 Windows 用的)
- 输出 `VERSION=...` 让 `pack-installer.sh` 解析

### 修改文件

#### `packages/branding/.gitignore`(+2 / -1)

加 `src/assets/icons/*/icon.icns` 一行 — 跟已有的 `icon.ico` 同源,都是 `apply-icons.sh` 现场生成的派生物,不该入仓。注释顺手补充说明 `iconutil` 流程。

#### 4 个 sh 脚本 mode `100644 → 100755`

`apply-icons.sh` / `build-deskfox.sh` / `png-to-icns.sh` / `restore-icons.sh` 加可执行位。这些脚本本就该是 executable(对称 `.ps1` 的 `Get-ExecutionPolicy` 行为),之前 `git add` 时 mode 被吃掉,这次顺手修。

mode +x 后可以直接 `./pack-installer.sh` 而不必每次 `bash pack-installer.sh`。

## 行数

| 项 | 行数 |
|---|---|
| `pack-installer.sh`(新) | 103 |
| `bump-installer-version.sh`(新) | 106 |
| `.gitignore`(改) | +2 / -1 |
| 4 个 sh mode change | 0 内容改动 |
| **代码 staged 净** | **~209 行 insertions** |
| 文档(新文件,不计阈值) | 本文件约 70 行 |

Tiny 级,远在 500 阈值内。无 large-diff,无 override(`packages/branding/scripts/` 是 fork-only 白名单内)。

## 影响范围

- ✅ macOS 一键打 prod installer:`bash packages/branding/scripts/pack-installer.sh` → bump + build + 报路径
- ✅ macOS 打 beta:`bash pack-installer.sh --env beta`
- ✅ Windows 一键流程不变(用 `.ps1`)
- ✅ 各平台 `installer-versions.md` 各维护各的 N 序列(Win 已到 `2026.4.29.2`,Mac 0 起步)
- ✅ apply-icons.sh 现场生成的 `icon.icns` 不再脏工作树
- ⚠️ 第一次 `pack-installer.sh` 跑下去,docs/installer-versions.md 会被修改(插 placeholder)— 完事 user 应填实际 commit 内容,然后 commit `installer-versions.md`。脚本不自动 commit(避免误提交)。

## 回归测试点

- [ ] `bash bump-installer-version.sh -Platform macOS --dry-run` 输出 `next=2026.4.30.1`(因为 30 号 Mac 0 笔)
- [ ] `bash pack-installer.sh --env prod`:bump 成功 + build 成功 + 列出 `.app` / `.dmg` 路径
- [ ] 装 `.dmg` 到 Applications + 启动 DeskFox + 一些核心功能(右键加聊天 / Option+Enter 提交 / Markdown 渲染)烟测过

(本 commit 落库时 user 还没实测一键 pack — 待打第一个 macOS 正式版时验证)

## review 自检

- [x] 仅触动 fork 白名单(`packages/branding/scripts/` + `packages/branding/.gitignore` + `docs/features/`)
- [x] 无 FORK marker 需求(.sh / .gitignore 是纯 fork-only 文件,非动上游)
- [x] git diff --stat insertions ≈ 209 行(Tiny 阈值内)
- [x] 无新增依赖(用系统自带的 `iconutil` / `hdiutil` / `cp` / `bash`)
- [x] sh shebang `#!/usr/bin/env bash` + `set -e` + 参数 case 解析模式与 .ps1 一致
- [x] 文件 mode 100755 已设置,可直接执行

## 回退方法

```
git revert <code commit hash>
```

新增脚本 + gitignore + mode change,纯 fork-only,无上游侵入,直接 revert 安全。注意 revert 后 `installer-versions.md` 上次 bump 留下的 placeholder 不会自动清,如需要去掉手动删那条 `## [macOS] YYYY.M.D.N — ...` block。
