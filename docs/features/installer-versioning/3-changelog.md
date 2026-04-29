---
feat-id: installer-versioning
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# installer-versioning — changelog

## 一句话

引入 DeskFox installer 版本号规则 `YYYY.M.D.N`(年.月.日.当天第几版,N 从 1 起,跨天重置),写 `bump-installer-version.ps1` + `pack-installer.ps1` 一键脚本,建立 `docs/installer-versions.md` 记录每次 ship。本次首发 `DeskFox-2026.4.29.1-setup.exe`。

## commit 列表

| commit | 简述 |
|---|---|
| `2bd3aa29e` | `feat(branding): installer 版本号规则 YYYY.M.D.N + 一键 pack 脚本 + 版本日志 [feat: installer-versioning]` |
| `af4290659` | `docs+feat(installer-versioning): 补三文档骨架 + platform 维度规则(Win/Mac 各自独立 N 序列)[feat: installer-versioning]` |

## 改动文件

| 文件 | 变更 | 备注 |
|---|---|---|
| `packages/branding/installer/DeskFox.iss` | +5 行 / -2 行 | `#define AppVersion "1.14.21"` → `"2026.4.29.1"`;注释扩充 + 引用 bump 脚本 |
| `docs/installer-versions.md` | +38 行新建 | 模板 + 2026.4.29.1 第一条 + 历史段 |
| `packages/branding/scripts/bump-installer-version.ps1` | +70 行新建 | 算今天 N + 改 .iss + 加占位 entry;ASCII 注释/路径 防 PS 5.1 中文坑 |
| `packages/branding/scripts/pack-installer.ps1` | +40 行新建 | 一键 bump + ISCC + 报路径 |
| `docs/features/installer-versioning/1-spec.md` | 新建 | spec |
| `docs/features/installer-versioning/2-plan.md` | 新建 | plan(决策轨迹 + PS 5.1 中文路径教训) |
| `docs/features/installer-versioning/3-changelog.md` | 新建 | 本文 |
| `docs/features/INDEX.md` | +1 行 | feature 索引 |
| `本仓 改动日志.md` | +1 行 | feature 索引 |

无 commit 改上游文件,无 FORK marker 增量。

## 起因

claude-code-loop-fix → cwd-channel 这条修复链多次重打 prod installer:
- 04-28 21:17 第 1 个 prod
- 04-29 11:48 第 2 个 prod(含 case-1 fix)
- 04-29 14:29 第 3 个 prod(含 case-1 + cwd channel 完整)

**全部都叫 `DeskFox-1.14.21-setup.exe`**(继承上游 baseline 不动),接收方区分不开。Windows 装新版可能因 AppVersion 一样跳过覆盖。

user 决定规范化:**`YYYY.M.D.N` 每次打包升一次,记日志**。

## 实现

### 1. .iss AppVersion 切换 + 注释扩充

```ini
; 版本号规则: YYYY.M.D.N (年.月.日.当天第几版,N 从 1 开始)
; 由 packages/branding/scripts/bump-installer-version.ps1 自动维护本行 AppVersion
; 也可命令行 override: iscc /DAppVersion=2026.4.29.2 DeskFox.iss

#ifndef AppVersion
  #define AppVersion "2026.4.29.1"
#endif
```

### 2. `bump-installer-version.ps1` 核心逻辑

```powershell
$today = Get-Date -Format "yyyy.M.d"
$logContent = Get-Content $logFile -Raw -Encoding UTF8
$existingNs = [regex]::Matches($logContent, "## $([regex]::Escape($today))\.(\d+) ") |
    ForEach-Object { [int]$_.Groups[1].Value }
$nextN = if ($existingNs) { ($existingNs | Measure-Object -Maximum).Maximum + 1 } else { 1 }
$newVersion = "$today.$nextN"

# Update .iss line
$iss = Get-Content $issFile -Raw -Encoding UTF8
$iss = $iss -replace '#define AppVersion "[^"]*"', "#define AppVersion `"$newVersion`""
Set-Content -Path $issFile -Value $iss -Encoding UTF8 -NoNewline

# Prepend placeholder to version log
# ...
Write-Output "VERSION=$newVersion"
```

### 3. `pack-installer.ps1` 一键

```powershell
# 1. bump version
$bumpOut = & .\bump-installer-version.ps1
$newVersion = ($bumpOut | Where-Object { $_ -match '^VERSION=' }) -replace '^VERSION=', ''

# 2. compile
& "C:\ProgramData\chocolatey\bin\ISCC.exe" .\DeskFox.iss

# 3. report
$installerPath = "...\Output\DeskFox-$newVersion-setup.exe"
Write-Output "[pack] installer ready: $installerPath"
```

### 4. PowerShell 5.1 中文路径坑(实战踩中)

文件名最初定 `版本日志.md`(根目录,跟 `改动日志.md` 对称),但 PowerShell 5.1 在 `Test-Path "$repoRoot/版本日志.md"` 时把中文按 GBK 误码成 `鐗堟湰鏃ュ織.md`,Test-Path 返回 false 抛"version log not found"。

**对策**:文件名改 ASCII `installer-versions.md`,放 `docs/` 下。这是**本仓 `.ps1` 第 3 次踩中文路径/注释 bug**,经验沉淀:**fork-only ps1 触碰的所有路径名 + 注释统一 ASCII**(注释在 build-deskfox.ps1 / apply-icons.ps1 已落实;路径在本次首次主动避免)。

## 验证

| 项 | 期望 | 实测 |
|---|---|---|
| ISCC 出 .1 installer | `DeskFox-2026.4.29.1-setup.exe` | ✅ 49 MB,14:49 |
| 旧 1.14.21 installer 已删 | Output/ 只剩一个新版 | ✅ |
| bump DryRun | 读到 .1,提议 .2 | ✅ `existing N=1, next=2026.4.29.2` |
| `docs/installer-versions.md` 第一条 entry | 含 commits / 配套 plugin / installer 路径 | ✅ |
| package.json × 2 不变 | 跟上游 1.14.21 | ✅(spec 决定不动) |

## 影响范围

- **代码**:`packages/branding/` 下 1 改 + 2 新文件;`docs/` 下 4 新文件;**全 fork-only,无 R4**
- **runtime**:无影响(只改 installer 编译版本号字段)
- **upstream merge**:`.iss` 是 fork-only 文件,rebase 不冲突
- **build flow**:`pack-installer.ps1` 是新增入口,`build-deskfox.ps1` + 单独 `iscc` 仍可用(向后兼容)
- **接收方**:每个版本文件名带日期 + 当日迭代号,Windows 装时不会跳过覆盖

## 回退方法

```bash
# 完全回退
git revert <commit-hash>

# 或手工:.iss AppVersion 改回 "1.14.21",删 docs/installer-versions.md + 两个 ps1
```

## 后续(留作 future)

- macOS .dmg / Linux .deb 等其他 platform installer 走同款规则(本次只做 Windows)
- pack-installer.ps1 加 `--git-tag` 选项(打 tag `installer/2026.4.29.1`),便于回溯
- 如果跨天打包频率上升,可加 `--no-bump`/`--force-version` 选项手动指定
- 上游 rebase 时,版本日志记录"baseline 升级"作为单独 entry(不打 installer 版本号)

## 经验沉淀

| 启示 | 落实位置 |
|---|---|
| installer 版本要跟 ship 节奏走,不能跟上游 baseline 绑死 | 本文 |
| fork-only `.ps1` 触碰路径 + 注释统一 ASCII(踩坑 3 次教训) | 本仓 `.ps1` 习惯 + CLAUDE.md 后续可补一句 |
| bump 脚本读自身日志算下一个 N,逻辑紧凑 5 行 PowerShell | 本文代码片段 |
| 一键 wrapper(`pack-installer.ps1`)消除"忘了 bump 直接 ISCC"风险 | 本文 |
| 跨平台版本号要分平台计数(N 不共享),否则 Win 团队跟 Mac 团队互相抢号 | 本文 follow-up + bump 脚本 -Platform 参数 |

## Follow-up: platform 维度补完(2026-04-29)

user 当天补规则:**Windows 和 macOS 各自独立 N 序列,同一天可以两边都 .1**。

举例:
- 同一天 Windows 打 1 次 → `[Windows] 2026.4.29.1`
- 同一天 macOS 打 2 次 → `[macOS] 2026.4.29.1`,`[macOS] 2026.4.29.2`
- **三个版本号并存,N 计数器独立,不互相影响**

### 实现

- `bump-installer-version.ps1` 加 `-Platform <Windows|macOS>` 参数(默认 Windows),regex 匹配 `## \[$Platform\] $today\.(\d+) ` 只看自己 platform 的 entry
- 版本日志 entry header 切换格式 `## [Platform] YYYY.M.D.N - timestamp`
- `pack-installer.ps1` 显式传 `-Platform Windows`(Windows 入口);macOS 入口 `pack-installer.sh` 后续补传 `-Platform macOS`
- `.iss` AppVersion 只在 Platform=Windows 时改(macOS 用 Info.plist / build-time arg,本次 stub)

### 实测

```
> bump -Platform Windows -DryRun
[bump] platform=Windows, today=2026.4.29, existing N=1, next=2026.4.29.2

> bump -Platform macOS -DryRun
[bump] platform=macOS, today=2026.4.29, existing N=, next=2026.4.29.1
```

✅ Windows 看到自己的 .1 提议 .2;macOS 看不到 Windows entry,独立从 .1 起算。

### 影响

- macos-打包 feature 后续接入时,直接用 `pack-installer.sh -Platform macOS` 即可,N 序列自动跟 Windows 解耦
- 现有 `[Windows] 2026.4.29.1` entry 已切换 header 格式,bump 脚本读得到
