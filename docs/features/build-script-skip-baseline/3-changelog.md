---
feat-id: build-script-skip-baseline
status: done
related: ./3-changelog.md
---

# build-script-skip-baseline — changelog

**关联 commit**: `8f22c4a27`
**所在分支**: `feat/build-script-skip-baseline`(已合 dev 即销毁)
**baseline**: `7eb3200ac`
**触发原因**: 2026-05-07 push `ship-mac-prod-2026.5.7.1` tag 触发 GitHub Actions `release-mac-deskfox.yml`,build 卡 57 分钟触发 macos-latest runner 1h 超时 cancelled,**0 release 产出**。诊断发现 `build-deskfox.sh` 在 sidecar 不存在时跑 `bun ./scripts/predev.ts`,`predev.ts` 内部 `build --single --baseline` 触发 `Bun.compile` 从 GitHub 拉 ~190MB 的 `bun-darwin-arm64-baseline` 运行时,CI 网络超时。

跟 Win 侧 2026-05-02 [`post-sync-build-fix`](../post-sync-build-fix/3-changelog.md) 同因 — 当时只修了 `.ps1`,Mac 端 `.sh` 漏修。

## 改动

### `packages/branding/scripts/build-deskfox.sh`(+27 / -6)

- **不调** `bun ./scripts/predev.ts`(它走 baseline 路径)
- **改成** `cd packages/opencode && bun run build --single`(不带 `--baseline`,复用本机 bun runtime,零下载)
- 加 `RUST_TARGET → BUILD_DIR_NAME` 映射(`aarch64-apple-darwin → opencode-darwin-arm64` 等 4 种)
- `cp dist/$BUILD_DIR_NAME/bin/opencode → sidecars/opencode-cli-${RUST_TARGET}` + `chmod +x`
- CI 干净 checkout 时 sidecars/ 目录可能不存在,加 `mkdir -p $(dirname $SIDECAR_PATH)`

完全对齐 Win 侧 `build-deskfox.ps1` 修法(commit `696bbcc00`)。

## 影响范围

- ✅ Mac arm64 / x86_64 build(`build-deskfox.sh`)
- ✅ Linux arm64 / x86_64 build(脚本加了映射,虽然本仓主要 Mac+Win 但 sh 通用)
- ❌ 不影响 Win build(`.ps1` 已经修过)
- ❌ 不影响 dev mode / `bun run dev`(脚本只在 release build 时跑)

## 验证

- 本地 mac arm64 + dev env:`rm sidecar + build-deskfox.sh -Env dev`,几秒出 120MB sidecar → tauri build → .app + .dmg 出来 → user 实测 .app 跑起来 docx 预览正常 ✅
- 本地 prod env:未单独测,但 dev/prod 走同 sidecar 路径,差异只在 tauri-overrides/<env>.json 品牌配置,不影响 sidecar build
- GitHub Actions CI:**待 push 后重新触发 tag 验证**(根因清晰,预期通过)

## 行数

| 项 | 行数 |
|---|---|
| `build-deskfox.sh` insertions / deletions | +27 / -6 |
| 文档(本文件)| ~50 行 |

Tiny 级,在规范 v2 阈值内。0 R4 / 0 黑名单 / 0 上游侵入。

## 回退方法

`git revert 8f22c4a27` — 恢复走 predev.ts(需要 baseline runtime 下载,CI 不可用,但本地 user 有 baseline 兜底也能 work)。

## 历史踩坑

Win 端 2026-05-02 修 `.ps1` 时显式注释:
> Mac 侧 build-deskfox.sh 自己控,不受影响。

实际"自己控"忽略了 Mac CI 下载 baseline 也会超时(CI 比本地网络通常更不稳定)。这次踩坑后 Mac/Win 两侧 build 脚本逻辑完全对齐,以后不会再有"一边修一边漏"。
