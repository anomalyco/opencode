---
feat-id: pack-installer-rebuild-step
status: done
related: ./3-changelog.md
---

# pack-installer-rebuild-step — changelog

## 一句话

修 `pack-installer.ps1` 顺序错位 SOP bug — 之前先 bump 版本号再 ISCC 编 installer,中间没 rebuild exe,导致 installer 文件名(`.11.1`)跟内部 exe UI 显示版本号(`.10.1`)mismatch。脚本加 1.5 step 自动重 build,exe 烧的 JSON 版本号跟文件名对齐。

> Tiny:1 文件 / +25 -6 行 / 0 R4 / 0 上游侵入。

## commit 列表

| commit | 简述 |
|---|---|
| `99c81fb60` | `fix(packaging): pack-installer.ps1 加 1.5 步重 build,修 bump→build→ISCC 顺序错位` |

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/branding/scripts/pack-installer.ps1` | +25 -6 行 | 加 step 1.5 在 bump 后自动调 `build-deskfox.ps1 -Env $Env -NoBundle`;加 `-SkipBuild` flag(CI 场景手动跳)+ 文档注释 + Usage 段更新 |

## 背景 — 用户反馈的 mismatch

2026-05-11 user 反馈刚 build 的 prod installer:
- 文件名:`DeskFox-2026.5.11.1-setup.exe`(脚本 bump 后命名)
- 装出来后 UI 左下角显示:**v2026.5.10.1**(跟文件名不一致)

跟踪源头 — `installer-versions.json` 的 `windows` 字段经 `vite` 在 build 时 `import` **烧进 bundle**(`setup-version-badge` feat 的设计,UI 不是 runtime 读文件)。

## 根因 — 顺序错位

```
原流程:
1. user 跑 build-deskfox.ps1 -Env prod -NoBundle   ← JSON 还是 .10.1
   → vite import 把 .10.1 烧进 dist/index.js
   → DeskFox.exe 内部 UI 版本号 = .10.1

2. user 跑 pack-installer.ps1 -Env prod
   step 1: bump JSON .10.1 → .11.1               ← 改完 JSON,但 exe 已编完
   step 2: ISCC 把上一步的 exe 压进 installer
   → installer 文件名 = .11.1(脚本 bump 后命名)
   → installer 内部 exe = .10.1(build 时烧进)
   → MISMATCH
```

任何人按"build → pack"顺序跑都会踩。

## 修法

在 pack-installer.ps1 step 1(bump)和 step 2(ISCC)之间插 step 1.5:

```powershell
# 1.5 重 build DeskFox.exe 让 UI 版本号跟 bumped JSON 同步
if ($SkipBuild) {
    Write-Output "[pack] -SkipBuild: 假设 target/release/DeskFox.exe 已是当前版本号,不重 build"
} else {
    Write-Output "[pack] 重 build DeskFox.exe(让 UI 显示版本号跟 installer 文件名对齐)..."
    & (Join-Path $here "build-deskfox.ps1") -Env $Env -NoBundle
    if ($LASTEXITCODE -ne 0) { throw "[pack] build-deskfox.ps1 failed with exit $LASTEXITCODE" }
}
```

新加 `-SkipBuild` flag(symmetric with `-SkipBump`)给 CI 场景:已外部 build 好,直接 pack。

## 验收

| 场景 | 修前 | 修后 |
|---|---|---|
| 跑 `build-deskfox.ps1 -Env prod -NoBundle && pack-installer.ps1 -Env prod` | installer 文件名 .11.1 + exe UI .10.1 mismatch | installer 跟 exe 都 .11.1 对齐 ✅ |
| 跑 `pack-installer.ps1 -Env prod -SkipBump` 现 JSON 已是新版 | exe 跟 installer 文件名都用旧的 .iss 版本(可能 stale)| 自动 build exe 用现 JSON 版本号 + ISCC 用 .iss 现版本号 ✅ |
| `pack-installer.ps1 -Env prod -SkipBump -SkipBuild` CI 模式 | 跟之前完全等价(回退默认行为)| 同 ✅ |
| user 改了代码想快速重 pack(不变版本号)| 得手动 build then SkipBump pack | `pack-installer.ps1 -SkipBump` 一条命令完成 |

## 实测

2026-05-11 实测:
- `pack-installer.ps1 -Env prod -SkipBump`(JSON 已是 .11.1 from 之前 bump)→ 自动重 build + ISCC → 新 installer 装出来 UI **v2026.5.11.1** 跟文件名对齐 ✓
- ISCC 自动覆盖旧 broken installer:`Deleting DeskFox-2026.5.11.1-setup.exe from output directory`

## R4 / 上游侵入

- 0 R4 override(脚本 fork-only)
- 0 上游侵入

## 跟随未 commit 的 bump 副作用文件

跑 `pack-installer.ps1`(不 SkipBump)会自动改 3 个文件作为 build 元数据:
- `packages/branding/installer/DeskFox.iss`(AppVersion)
- `packages/branding/installer-versions.json`(windows 版本号)
- `docs/installer-versions.md`(placeholder)

这些是 packaging step 副产物,不在本 fix commit 范围。本 fix 解决脚本顺序问题,版本号管理由 user 决定 ship release 时再 commit + tag。
