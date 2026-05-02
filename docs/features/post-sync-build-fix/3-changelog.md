---
feat-id: post-sync-build-fix
status: done
related: ./3-changelog.md
---

# post-sync-build-fix — changelog

## 一句话

`sync/upstream-2026-05-02` merge 后 build 链路两个 latent 问题浮出 — ① Windows symlink 落空导致 TS 编译失败(以前靠 *.tsbuildinfo 增量缓存假装通过)② sidecar build 走 `--baseline` 触发 ~190MB Bun runtime 从 GitHub 下载,clash/国内网络常超时;两笔修复一次到位,本机 zero-download build 通到底。

> Tiny 规模:核心 fix 共 4 文件、净 ~12 行有效代码 + 注释 + override 论证;无 1-spec / 2-plan,见本文。

## commit 列表

| commit | 简述 |
|---|---|
| `0a17210da` | `fix(build): custom-elements.d.ts 修 Windows symlink 落空 [feat: post-sync-build-fix] [override-blacklist: ...]` |
| `696bbcc00` | `fix(build): sidecar 绕过 Bun baseline runtime 下载 [feat: post-sync-build-fix]` |
| (本笔 commit) | `docs(changelog): post-sync-build-fix 索引 + 详细 changelog [feat: post-sync-build-fix]` |

## 改动文件

| 文件 | 变更 | 备注 |
|---|---|---|
| `packages/app/src/custom-elements.d.ts` | mode 120000 → 100644,内容 1 行 → 3 行 | 原 symlink → `../../ui/src/custom-elements.d.ts`;新文件 `/// <reference path="..."/>` + `export {}` 等价语义,加 FORK marker |
| `packages/enterprise/src/custom-elements.d.ts` | 同上 | **R4 override(blacklist)**,wrapper 路径替代不可行,论证见下 |
| `packages/branding/scripts/build-deskfox.ps1` | 净 +0 行(替换段落 ~25 行) | 移除"调 predev.ts + non-baseline/baseline 双产物 fallback",改"直接 cd opencode 跑 build --single",绕开 Bun baseline runtime 下载 |

## 根因 — 问题 1:Windows symlink 落空

### 表现

`bun run typecheck` 在 `@opencode-ai/app` / `@opencode-ai/enterprise` 报 TS 错,`packages/{app,enterprise}/src/custom-elements.d.ts` 内容是 `../../ui/src/custom-elements.d.ts`(纯路径文本)被 TS 当成代码读。

### 真相

upstream 这两个文件是 POSIX symlink(git mode `120000`)指 `packages/ui/src/custom-elements.d.ts`,Mac/Linux clone 时 git 自动创建真 symlink。Windows 默认 `core.symlinks=false`(全局默认 / 仓库默认),git 把 symlink 落成包含 link target 的普通文本文件 → TS 拿到的不是 .d.ts 内容是路径字符串。

### 为什么之前能 build

`tsgo -b` 走增量(incremental):`*.tsbuildinfo` 缓存了"这个文件之前编译过"的状态,跳过重检。fork 自打第一天就有这问题,但 build 没炸。`sync/upstream-2026-05-02` merge 改动量大,缓存被冲掉,latent bug 浮出。

### 修法

`packages/{app,enterprise}/src/custom-elements.d.ts` 由 symlink(mode 120000)转 mode 100644 真文件,内容:

```ts
// FORK: Windows core.symlinks=false 下 upstream symlink 落成纯文本路径,TS 读不懂;改 triple-slash 引用真文件 2026-05-02
/// <reference path="../../ui/src/custom-elements.d.ts" />
export {}
```

`/// <reference path>` 是 TS 原生的 .d.ts 引用机制,语义等同"把目标文件的 type augmentation 拉进当前文件作用域"——和原 symlink 让 TS 直接读真源效果等价。`export {}` 保留 module 性质(原文件结尾就是 `export {}`)。

git 操作:`git rm --cached <file>` 清掉 mode 120000 索引,Write tool 写新内容,`git add` 自动按 working tree 真文件登记成 mode 100644。

### R4 override 论证(`packages/enterprise/`)

- **wrapper 不可行性**:文件本身就是 TS 自动 pick-up 的 `.d.ts`(`include: src` 默认包含),`packages/enterprise/src/custom-elements.d.ts` 这个**路径**就是 broken,任何"新增 wrapper 文件"都改不掉这个 broken 文件——必须就地转真文件。配 `core.symlinks=true` + Windows Developer Mode 是系统级设置,每个新 contributor 都得手动开,不适合 fork 长期方案。
- **风险**:mode change 完全可逆(`git rm --cached` + 重建 symlink 即还原);Mac/Linux contributor pull 后拿 mode 100644 真文件,语义等同;upstream 改 `packages/ui/src/custom-elements.d.ts` 内容时 reference 自动跟随,不需后续维护。
- **配额**:`packages/app` + `packages/enterprise` 两个文件同笔 commit,按 R4 "一笔 commit 触动多个黑名单文件算 1 笔" → 1 笔 override(2026-Q2,本季首笔)。

### 跨平台一致性

新文件 mode 100644 + reference 是 cross-platform 通用 — Mac/Linux pull 后不再拿 symlink,直接拿真文件。reference 路径 `../../ui/src/custom-elements.d.ts` 跟原 symlink target 完全一致,语义零差异。

## 根因 — 问题 2:Bun baseline runtime 下载

### 表现

`build-deskfox.ps1` 走 `bun ./scripts/predev.ts`,predev 内部按 `SIDECAR_BINARIES` 表(`packages/desktop/scripts/utils.ts`)对 `x86_64-pc-windows-msvc` 走 `opencode-windows-x64-baseline` → 触发 `bun run build --single --baseline` → `Bun.build({ target: "bun-windows-x64-baseline" })` → Bun 内部从 GitHub 拉 `bun-windows-x64-baseline.zip`(~190MB) → clash/国内网络常超时,build 失败。

### 历史上的 workaround

以前 `build-deskfox.ps1` 加了"non-baseline 优先 + baseline fallback":如果 `dist/opencode-windows-x64/bin/opencode.exe` 在 10 分钟窗口内有,就用它(因为 `--single --baseline` 实际上同时 build 非 baseline + baseline,非 baseline 先 build,先成功;baseline 后 build,download 失败。靠这个时序兜)。但每次 build 仍然要等 baseline download 失败、走兜底,流程脆弱。

### 修法

干脆不调上游 `predev.ts`,在 `build-deskfox.ps1` 直接:

```ps1
Push-Location (Join-Path $repoRoot "packages/opencode")
try {
    bun run build --single
    if ($LASTEXITCODE -ne 0) { throw "..." }
} finally { Pop-Location }

$srcBin = ".../packages/opencode/dist/opencode-windows-x64/bin/opencode.exe"
Copy-Item -Force $srcBin $sidecarPath
```

`bun run build --single`(没有 `--baseline`)经过 `build.ts` 的 filter,只保留 `{os: win32, arch: x64}` 一个非 baseline target。`Bun.build({ target: "bun-windows-x64" })` 复用本机已装的 bun 1.3.13 runtime,**零 GitHub 下载**。

### 为什么不需要 baseline

baseline 是给老 CPU(无 AVX2 的 Sandy Bridge 之前)兜底用,DeskFox 用户群默认现代 CPU(2013+ Intel / 2015+ AMD 都有 AVX2),baseline binary 不需要。

### 改动归属

只改 `packages/branding/scripts/build-deskfox.ps1`(fork-only),**零 upstream 改动**(P1 隔离),不需要 FORK marker(R2 只对上游文件)。Mac 侧 `build-deskfox.sh` 自己控,不受影响(Mac 没有 clash 代理问题,upstream predev.ts 在 Mac 上工作正常)。

## 验证

- ✅ `bun run typecheck`:清 `*.tsbuildinfo` + 所有 `node_modules/.ts-dist` + `.turbo/cache` 后,15 个 typecheck task 全 cache miss、全 pass(14.8s)— 确认无增量缓存假装
- ✅ `build-deskfox.ps1 -Env dev -NoBundle` 端到端跑通:删 sidecar + 删 dist 强制走新 build 路径,vite build 17.94s + cargo release 2m14s,产物 `DeskFox.exe` 32.2MB + sidecar 190MB 都到位
- ✅ build log 检查:全程零 "baseline" 字样、零 GitHub 下载尝试、smoke test passed(`Smoke test passed: 0.0.0-feat/post-sync-build-fix-...`)

## 影响范围

- **runtime**:零变化(.d.ts 是 type-only,build pipeline 改的是 sidecar build 流程,产物 binary 跟之前手动从 dist/ 拷的等价)
- **跨平台**:Mac/Linux contributor 后续 pull 拿 mode 100644 真文件 + triple-slash reference,语义等同 symlink,不需要 `core.symlinks=true`
- **CI**:`.github/workflows/*-deskfox.yml` 走 GitHub Actions runner,Linux runner 自带 `core.symlinks=true`,我们的 mode 100644 真文件他们也能正常读(就是普通文件)。CI 现状不变。
- **upstream merge**:未来 sync 若 upstream 改 `packages/{app,enterprise}/src/custom-elements.d.ts` symlink 本身,merge 会冲突 — 易识别;若改 `packages/ui/src/custom-elements.d.ts` 内容,reference 自动跟随,无需手动维护。

## 回退方法

```bash
git revert 0a17210da 696bbcc00
# Mac/Linux 后续如要恢复 symlink:rm packages/{app,enterprise}/src/custom-elements.d.ts && cd packages/{app,enterprise}/src && ln -s ../../ui/src/custom-elements.d.ts custom-elements.d.ts
```
