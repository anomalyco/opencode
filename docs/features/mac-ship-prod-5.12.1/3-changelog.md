---
feat-id: mac-ship-prod-5.12.1
status: done
related: ./3-changelog.md
---

# mac-ship-prod-5.12.1 — changelog

## 一句话(Tiny ship)

Mac 端跟 Win 5.12.1 同步出 prod .dmg + 上传 GitHub Release + Gitee Release(双平台分发,**反转 2026-05-06 立的"Mac 不跑 Gitee"memory 规则**)。包内容完全等于 Win 5.12.1。

## 包内容(dev 上现有 feat,跨平台代码)

- `imbot-permission-minimal`(V2 → V3 极简档,8 ask)
- `imbot-windows-delete-cmds`(V3.1 加 4 Win 风格 pattern,共 13 ask;Mac 端 dead weight 但保留对齐)
- `dedup-cache-persist`(DedupCache 落盘)
- `feishu-plugin-dedup-decision`(根因诊断 + 决策注释 + 开发机 build hook)
- `build-script-json-fallback` + follow-up `33c7dd948`(`grep -c` 兜底 fix,Mac 端实测撞过)
- `sdk-falsy-error-fallback-fix`(5.11.x 翻车真因)

## 改动文件(本笔 ship)

| 文件 | 改动 |
|---|---|
| `packages/branding/installer-versions.json` | macos `2026.5.11.1` → `2026.5.12.1` |
| `docs/installer-versions.md` | 加 [macOS] 2026.5.12.1 entry(在 [Windows] 2026.5.12.1 之上) |
| `docs/features/mac-ship-prod-5.12.1/3-changelog.md` | 新 — 本文档 |
| `docs/features/INDEX.md` + `改动日志.md` | 索引行 |

`packages/branding/installer/DeskFox.iss`(Win NSIS 配置)**不动** — Mac 不依赖。

## 三铁律走流程

| 步骤 | 状态 |
|---|---|
| 开 feat 分支 `feat/mac-ship-prod-5.12.1` | ✅ |
| 本地 commit 不动 dev | ✅(user 同意后才合)|
| → dev merge user 同意 | (待 user 拍)|
| → origin/dev push user 同意 | (待 user 拍)|
| `ship-mac-prod-2026.5.12.1` tag user 同意 | (待 user 拍)|
| GitHub Release publish | (待 user 拍)|
| Gitee Release publish | (待 user 拍,**反转规则后第一次**)|

## Build 过程

1. **bump installer-versions.json macos `2026.5.11.1` → `2026.5.12.1`**(对齐 Win 5.12.1,因 dev 上代码状态完全等于 Win 5.12.1 那笔)
2. **quit DeskFox** + 跑 `bash packages/branding/scripts/pack-installer.sh --env prod --no-bump`
3. **cargo build 35s** + Tauri bundling → 出 `.app` + `.dmg`(Tauri 内部版本 1.14.33 命名)
4. **手动 rename** `DeskFox_1.14.33_aarch64.dmg` → `DeskFox-2026.5.12.1_aarch64.dmg`(模拟 pack-installer.sh 的 rename 逻辑,因为 `--no-bump` 时 NEW_VERSION 空跳过 rename)
5. **cp 兜底** `target/release/DeskFox` → `.app/Contents/MacOS/DeskFox`(memory 警告完整 build 后 .app 内 binary 仍可能老);实测本次 shasum 一致(`e3cc0e3cc...`),Tauri bundler 这次工作 OK,cp 是 idempotent 兜底

## Build 产物

```
✓ raw binary: target/release/DeskFox (39945968 bytes)
✓ .app bundle: target/release/bundle/macos/DeskFox.app
✓ .dmg:        target/release/bundle/dmg/DeskFox-2026.5.12.1_aarch64.dmg (64645764 bytes)
```

## 已知陷阱(踩了)

| 陷阱 | 处理 |
|---|---|
| `pack-installer.sh --no-bump` 跳过 rename 留 Tauri 内部命名 `DeskFox_1.14.33_aarch64.dmg` | 本次手动 rename,加进需求池后续修(让 `--no-bump` 时仍从 installer-versions.json 读当前 macos 字段做 rename)|
| fresh prod 首次启动 sidecar idle 2 分钟+ | 已记需求池 `prod-首次启动-sidecar-idle.md`(怀疑 TCC 授权对话框阻塞 desktop 主进程,等下次 fresh user 装包时实测复现)|
| Tag 命名跟 Win 撞 | 用 `ship-mac-prod-2026.5.12.1` 加 mac 前缀避免(historical tag 没区分平台,本笔起 Mac ship 永远加 mac 前缀)|

## 双平台分发

### GitHub Release
- 仓库:`zoulukuang/deskfox`
- Tag:`ship-mac-prod-2026.5.12.1`
- Asset:`DeskFox-2026.5.12.1_aarch64.dmg`

### Gitee Release(**反转 memory 规则,2026-05-12 起 Mac ship 也推 Gitee**)
- 仓库:`zoulukuang/deskfox`(Gitee 镜像)
- Tag:`ship-mac-prod-2026.5.12.1`
- Asset:同 GitHub

**reverse 历史**:
- 2026-05-04:立"Mac 端 ship 必须跑 Gitee"
- 2026-05-06:反转为"Mac 端 ship 不跑 Gitee,Win 端 user 处理"(分工)
- **2026-05-12(本笔)**:再次反转回"Mac 端 ship 也推 Gitee" — user 拍板"以后用这种方式处理"

## Memory 同步更新

- `feedback_mac_ship_gitee_mirror.md` 反转到"Mac ship 也推 Gitee",起源标 2026-05-12
- MEMORY.md 索引行同步

## R5 测试覆盖豁免

Tiny ship chore — 0 业务逻辑改动 + bump 文件 + docs。实测验证(typecheck 16/16 / cargo 19/19 / 三次 build/launch 实战)在 docs/installer-versions.md 列。

## R4 / 上游侵入

- 0 R4 override
- 0 上游侵入

## 关联

- 起源:user 决策"打本地正式包用正式版本号命名" + 后续"发布到两个平台"
- 包内容跟 `win-ship-prod-5.12.1`(`33df15b6a`,Win 端 push)完全相同
- 反转的 memory:`feedback_mac_ship_gitee_mirror.md`(2026-05-06 立 → 2026-05-12 反转)
- 需求池新增:
  - `prod-首次启动-sidecar-idle.md`(fresh user TCC 阻塞)
  - `imbot-agent-自动升级.md`(老 user 装新包不自动升级 imbot schema)
  - pack-installer.sh `--no-bump` rename 漏洞(待加)

## 规模

**Tiny ship chore** — bump 1 行 + docs 多文件 + 一笔 commit + tag + 双平台 release。
