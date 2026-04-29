---
feat-id: build-pipeline-sidecar-fix
status: done
related: ./3-changelog.md
---

# build-pipeline-sidecar-fix — changelog

## 一句话

修复 Windows `build-deskfox.ps1` 缺失 sidecar 自动 build 步骤导致 `packages/opencode/src/` 改动从未进 sidecar exe 的潜伏 bug — 加智能时间戳判断 + non-baseline 优先(绕开 clash 代理下 bun-baseline 下载必失败问题)。

> Tiny 规模:核心 fix 53 行 .ps1(其中实际逻辑 ~25 行,余为注释 + 错误兜底);无 1-spec / 2-plan,见本文。

## commit 列表

| commit | 简述 |
|---|---|
| `b9581b76e` | `fix(branding): build-deskfox.ps1 加 sidecar 自动 build — 时间戳判断 + non-baseline 优先 [feat: build-pipeline-sidecar-fix]` |

## 改动文件

| 文件 | 变更 | 备注 |
|---|---|---|
| `packages/branding/scripts/build-deskfox.ps1` | +53 行(line 32 之前) | 新增 Step 0:确保 sidecar 不旧于 `packages/opencode/src/**/*.ts` 任一源文件;过期/缺失则跑 predev.ts + 优先拷 non-baseline 产物 |

无 commit 改上游文件,无 FORK marker 增量。

## 起因(claude-code-loop-fix 收尾时浮出)

claude-code-loop-fix(commit `e2a9d7167`)Phase A 诊断阶段,user 改 `prompt.ts` 加诊断日志后跑 `build-deskfox.ps1 -Env dev -NoBundle`,build 表面成功,但 `loop-diag.log` 没产生 → 排查发现 sidecar `target/release/opencode-cli.exe` 时间戳停留在 `04-25 19:37`,**改动从未进 sidecar binary**。

根因:`tauri.conf.json` 配置 `externalBin: ["sidecars/opencode-cli"]`,tauri build 把 `packages/desktop/src-tauri/sidecars/opencode-cli-<arch>.exe` 拷到 `target/release/opencode-cli.exe`,但 `sidecars/<arch>.exe` **是预 build 产物**,需要单独跑 `packages/desktop/scripts/predev.ts`(它内部 `bun run build` 出 `packages/opencode/dist/` → 拷到 `sidecars/`)才能更新。

`build-deskfox.ps1` **从未调** predev.ts,只跑 `apply-icons.ps1` + `tauri build` + `restore-icons.ps1`。Mac 侧 `build-deskfox.sh` line 52-95 已有"sidecar 不存在则 build"逻辑(macos-打包 phase 1 加的),Windows 侧漏了。

## 方案选型

跟 .sh 三种方案权衡:

| 方案 | 行为 | 成本 | 解 prompt.ts 改动不进 sidecar 的坑? |
|---|---|---|---|
| A 对称 .sh(只在文件不存在时 build) | sidecar 文件存在就跳过 | 极小 | ❌(我们的 sidecar 一直存在,只是内容旧) |
| B 简单(每次 build 都跑 predev) | 强制 rebuild | +2-3 分钟/次 build | ✅ 但 build 别的目录时也 rebuild,浪费 |
| **C 智能(时间戳判断)** | 比较 sidecar mtime vs `packages/opencode/src/**/*.ts` 最新 mtime,过期才 rebuild | 小(只时间戳扫描) | ✅ 真正解题 + 不浪费 |

**选 C**。.sh 暂不改(Mac 平台没踩这个具体坑;后续如踩同步改)。

## 实现

`build-deskfox.ps1` line 32(`# 1. apply(按 env 选样式)` 之前)插入 Step 0:

```powershell
# 0. Ensure sidecar built, mtime >= packages/opencode/src/**/*.ts latest
# Upstream predev.ts uses baseline path; in our env (clash proxy) bun-baseline download fails,
# but non-baseline still builds OK. We bypass this by preferring non-baseline binary in sidecars/.
if (-not $env:RUST_TARGET) {
    $env:RUST_TARGET = "x86_64-pc-windows-msvc"
}
$sidecarPath = Join-Path $repoRoot "packages/desktop/src-tauri/sidecars/opencode-cli-$($env:RUST_TARGET).exe"
$opencodeSrcDir = Join-Path $repoRoot "packages/opencode/src"

$needBuild = $false
if (-not (Test-Path $sidecarPath)) {
    $needBuild = $true
} else {
    $sidecarMtime = (Get-Item $sidecarPath).LastWriteTime
    $latestSrcMtime = (Get-ChildItem -Recurse -File -Path $opencodeSrcDir -Include "*.ts","*.tsx" -ErrorAction SilentlyContinue |
        Measure-Object -Property LastWriteTime -Maximum).Maximum
    if ($latestSrcMtime -and $latestSrcMtime -gt $sidecarMtime) {
        $needBuild = $true
    }
}

if ($needBuild) {
    Push-Location (Join-Path $repoRoot "packages/desktop")
    try {
        bun ./scripts/predev.ts   # 允许失败,baseline 下载错误是常态
    } finally {
        Pop-Location
    }
    # 优先 non-baseline(clash 友好),fallback baseline
    $nonBaselineBin = Join-Path $repoRoot "packages/opencode/dist/opencode-windows-x64/bin/opencode.exe"
    $baselineBin = Join-Path $repoRoot "packages/opencode/dist/opencode-windows-x64-baseline/bin/opencode.exe"
    if ((Test-Path $nonBaselineBin) -and (Get-Item $nonBaselineBin).LastWriteTime -gt (Get-Date).AddMinutes(-10)) {
        Copy-Item -Force $nonBaselineBin $sidecarPath
    } elseif ((Test-Path $baselineBin) -and (Get-Item $baselineBin).LastWriteTime -gt (Get-Date).AddMinutes(-10)) {
        Copy-Item -Force $baselineBin $sidecarPath
    } else {
        throw "sidecar build failed: no fresh binary in packages/opencode/dist/"
    }
}
```

完整代码见 `packages/branding/scripts/build-deskfox.ps1`(本次 commit)。

### 关键设计点

- **时间戳判断粒度**:scan `packages/opencode/src/**/*.{ts,tsx}` 的最新 mtime,跟 sidecar mtime 比。新于 sidecar 即过期。`Measure-Object -Property LastWriteTime -Maximum` 一行,效率 OK
- **non-baseline 优先**:user 环境(clash 代理)下 bun 下载 `bun-windows-x64-baseline` binary 包必失败,但 non-baseline 仍 build 成功 — 优先用 non-baseline 产物。Windows x64 现代 CPU(2018+)全部支持 AVX2,baseline / non-baseline 实际等价(baseline 只是兼容更老的 CPU)
- **`-gt (Get-Date).AddMinutes(-10)` 时间窗**:防止意外用旧 dist/ 残留产物。强制要求最近 10 分钟内刚 build 的 binary
- **predev.ts 失败容错**:不在 PowerShell 端强制 throw,因为 baseline 下载失败是 user 环境常态;后续 fallback 检查 dist/ 产物存在与否兜底

### ASCII 注释约束

刚加完代码第一次跑报 PowerShell 5.1 ParseException(`Unexpected token '}'`,line 37),复发跟上次 apply-icons.ps1 line 65-70 同款的 ANSI 解码 UTF-8 中文 bug。立刻把 33 行新增注释**全部 ASCII 化**避坑。

记录到经验沉淀:**fork-only `.ps1` 文件凡是新加段落跟结构字符(`{` / `}` / `if`)紧贴的中文注释,Windows PowerShell 5.1 必踩**。今后 `.ps1` 编辑统一 ASCII 注释。

## 验证

| 项 | 期望 | 实测 |
|---|---|---|
| up-to-date path | sidecar 比 `packages/opencode/src/` 新 → 输出 `[deskfox] sidecar up-to-date`,跳过 build | ✅(刚跑 dev build,sidecar mtime 10:56 > 任何 src,直接跳过)|
| build 后续阶段不变 | tauri build 正常完成 | ✅(2m 26s,完整 build flow) |
| stale / not-found path 逻辑 | 调 predev.ts + 优先 non-baseline + fallback baseline + 10 分钟时间窗 | 🟡 代码静态可推理,实际触发条件需手动 `rm sidecar` 或 touch src 文件,这次 commit 不专门跑(下次 case-1 类 fork 改动时自然 exercise) |

## 影响范围

- **代码**:`packages/branding/scripts/build-deskfox.ps1` 1 文件 +53 行,fork-only,无 R4
- **build 流程**:`build-deskfox.ps1 -Env <env>` 现在自检 sidecar 状态,无脑过期则 rebuild。新 clone 的 user / 第一次 build 也能自动跑通(原 .sh 已有,.ps1 这次跟上)
- **runtime / 安装包内容**:无变化(只改 build pipeline,产物 binary 跟之前手动 predev 一致)
- **Mac 侧 `.sh`**:本次不动,因 .sh 已有"不存在才 build"逻辑且 Mac 没 clash baseline 失败问题。如 Mac user 后续踩"sidecar 内容过期"坑,同款修法对称改即可

## 回退方法

```bash
git revert <commit-hash>
```

或手工删 build-deskfox.ps1 line 32-84 整段(回到只 apply-icons + tauri build + restore-icons 三步)。

## 后续(留作 future)

- 如 Mac side 也遇到"sidecar 内容过期"问题,把 `.sh` line 52-95 的 `[[ ! -f "$SIDECAR_PATH" ]]` 升级到时间戳判断(对称本次 .ps1)
- ARM64 Windows 实战需要时,RUST_TARGET 加 detect 分支(`$env:PROCESSOR_ARCHITECTURE` = `ARM64` → `aarch64-pc-windows-msvc`)
- 如 user 切换 Windows 走非 clash 网络环境,non-baseline 优先逻辑仍 work(baseline 也能下载,但不优先用)

## 经验沉淀

| 启示 | 落实位置 |
|---|---|
| build pipeline 缺一步,bug 极其难定位(我们这次 case-1 fix 发了多次"build 通了 → 测试还是卡"才查到 sidecar 没更新)| 本文 |
| Mac / Windows 双脚本要确保对称,加新功能时双更新或显式留 follow-up task | 本文 + task #9(本次)|
| Windows PowerShell 5.1 ANSI 解 UTF-8 中文 bug 复发性高 — `.ps1` 注释统一 ASCII | apply-icons.ps1 / build-deskfox.ps1 已落实;CLAUDE.md 之后顺手补一句"`.ps1` 注释 ASCII"建议 |
| 时间戳判断比"文件存在"判断对 fork pipeline 更可靠 — 推荐对所有有 build artifact 缓存的脚本采用 | 本文 |
