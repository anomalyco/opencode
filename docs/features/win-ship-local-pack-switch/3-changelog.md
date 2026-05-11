---
feat-id: win-ship-local-pack-switch
status: done
related: ./3-changelog.md
---

# win-ship-local-pack-switch — changelog

## 一句话

停掉所有 GitHub Actions 自动出安装包 + 镜像 Gitee 的 workflow(Win build / Mac build / Gitee mirror 三条),改为统一"本地打包 + 手动上传 GitHub Release + API 创 Gitee release + 跑 mirror-asset-to-gitee.ps1"流程。决策起源 2026-05-11 ship 2026.5.11.1 时 Win build workflow 撞 sidecar build deadlock。

> Tiny:3 文件 / +85 -32 行 / 0 R4 / 0 上游侵入 / 3 笔 commit。

## commit 列表

| commit | 简述 |
|---|---|
| `2bf125c15` | `chore(workflows): disable release-deskfox + release-mirror-gitee-deskfox` — Win build + Gitee mirror 两条停 |
| `84724c3cc` | Merge `chore/disable-win-and-gitee-release-workflows` into dev |
| `6bd10a6df` | `chore(workflows): disable release-mac-deskfox` — Mac build 也停(初版漏掉,user 拍板补) |
| `f07cef44e` | Merge `chore/disable-mac-release-workflow` into dev |

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `.github/workflows/release-deskfox.yml` | +20 -10 行 | 注释原 `on:` 块(`push: tags: ship-prod-* / ship-beta-*` + workflow_dispatch),改 placeholder 只剩 workflow_dispatch with `_disabled_notice` input |
| `.github/workflows/release-mirror-gitee-deskfox.yml` | +20 -7 行 | 同样手法 — 注释 `on: release: published` + dispatch,换 disabled placeholder |
| `.github/workflows/release-mac-deskfox.yml` | +30 -13 行 | 同样手法 — 注释 `on: push: tags: ship-mac-prod-*` + dispatch,换 placeholder |

总改动 +85 -32 行 / 3 文件 / 0 R4 / 0 上游侵入。

## 决策背景

### Win 触发(直接原因)

2026-05-11 跑 `ship-prod-2026.5.11.1` tag push 触发 `release-deskfox.yml` workflow,Build 步跑了 50 分钟 console **完全静默**(line 934 `Resolved, downloaded and extracted [5]` 一字不变),60min job timeout 被 Actions 自动 cancel。

console 分析:frontend vite bundle ✅ 完(44s),`bun add` ✅ 完(line 932-934),**然后 sidecar Rust 编译该启动但完全没启动**(没任何 `Compiling xxx` 输出)。Rust release build 即使编最大 crate 也会持续打印 `Compiling` 行,50 分钟完全静默 = 真死锁,不是慢。

根因猜测(待新会话查代码确认):`bun run build --single` 这个 sidecar build script 在 GH Actions windows-latest runner 上某处死锁 — 可能是 child process pipe 没 flush / 子进程 stdout 写满阻塞 / 内部死等条件。本地有终端不撞 pipe 问题,GitHub Actions runner 上 stdout 走 pipe 容易踩坑。

### Gitee mirror(顺手发现)

ship 2026.5.11.1 时发现 Gitee 上**最新 release 还是 5.3.1**(5.5.1 / 5.9.1 全没),但 GitHub Actions log 显示这俩 mirror workflow run "success"。说明 `release-mirror-gitee-deskfox.yml` 长期 silent fail,报 success 但没在 Gitee 真建 release。根因未深查(可能 Gitee API 鉴权 / token 过期 / format 改了)。

本笔 user 决策一起停 — 既然 GitHub Release 改本地手动 publish,这条 mirror 也无需自动化。

### Mac 端(user 拍板扩大范围)

初版 commit `2bf125c15` 保留 Mac(理由:Mac 历史成功 ship 4 次 + 本地 Win 机器无法 build .dmg)。user 看完拍板:Mac 也停。

理由(user 表述):"维持一套 CI 注定要持续投精力维护",且 Mac 端使用频次低,等有 Mac 机器或后续治理时再复活。

## 新的 ship 流程(本地打包 + 手动上传)

### Win

```
1. .\packages\branding\scripts\pack-installer.ps1 -Env prod
   → 自动 bump + rebuild exe + ISCC 编 installer
   → 产物在 packages/branding/installer/Output/DeskFox-<version>-setup.exe
2. commit bump 副产物 + 回填 docs/installer-versions.md entry
3. push origin dev + push tag ship-prod-<version>
4. gh release create ship-prod-<version> <installer-path> --draft --notes-file <body>
5. user 审 draft → publish
6. Gitee API 手动创 release(target_commitish=dev)— 命令:
   curl -X POST https://gitee.com/api/v5/repos/zoulukuang/deskfox/releases \
     --data-urlencode "access_token=$GITEE_TOKEN" \
     --data-urlencode "tag_name=ship-prod-<version>" \
     --data-urlencode "name=DeskFox <version>" \
     --data-urlencode "body@<body-file>" \
     --data-urlencode "target_commitish=dev" \
     --data-urlencode "prerelease=false"
7. .\packages\branding\scripts\mirror-asset-to-gitee.ps1 -Tag ship-prod-<version>
   → 7 秒 / 66 Mbps 推 .exe 到 Gitee release
```

2026.5.11.1 ship 即首次实战验证本流程,7 步全跑通(详见 [`installer-versions.md`](../../installer-versions.md) 2026.5.11.1 entry)。

### Mac

暂搁(本地 Win 机器无法 build .dmg)。等下次需要 ship Mac 时:
- 临时复活 `release-mac-deskfox.yml`(取消文件内 `on:` 注释,跑一次,再 disable)
- 或有 Mac 机器后补 `pack-installer.sh` 本地流程

## 复活方式

每个 disabled workflow 文件头部都有 disabled 注释段。复活:

1. 删文件顶部 `─── 🚧 2026-05-11 起 DISABLED ───` 整段注释
2. 取消下方 `# on:` 整块注释
3. 删尾部 `on: workflow_dispatch with _disabled_notice` placeholder
4. commit + push

## 跟进 backlog

- **🔴 sidecar build CI deadlock 根因研究**:`bun run build --single` 在 GH Actions runner 上 `bun add` 后 stdout 静默挂死。涉及代码:`packages/desktop/script/build.ts`(或类似 build orchestration)+ opencode sidecar build flow。新会话查
- **🔴 Gitee mirror workflow silent fail 根因研究**:`release-mirror-gitee-deskfox.yml` 报 success 但 Gitee API 没真建 release。涉及 workflow log + Gitee API 鉴权流程
- **🟡 Mac 本地打包流程补全**:`pack-installer.sh` 已有(在 `packages/branding/scripts/`),但 Mac ship 流程整套(bump → build → gh release create → mirror)还没在 governance 文档里固化。等有 Mac 机器时治理

## R4 / 上游侵入

- 0 R4 override(纯 fork-only `.github/workflows/*-deskfox.yml`)
- 0 上游侵入

## 回退方法

`git revert f07cef44e 84724c3cc`(逆序两笔 merge commit),会恢复所有 workflow 原 `on:` 触发条件。
