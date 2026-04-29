---
feat-id: macos-打包
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# macos-打包 — changelog

## 一句话

DeskFox 打成 macOS `.app` + `.dmg`,Phase 1 scaffolding(脚本 + 文档 + 资源补齐)在 Windows 完成,Phase 2 user 在 Mac 上首次 build **2026-04-29 验证打通**,scaffolding 经实战检验可用。

## Phase 1 已落地(本仓内 scaffolding)

### commit 列表

| commit | 简述 |
|---|---|
| `e956d6c90` | `feat(macos): Mac 打包 Phase 1 scaffolding` — 4 个 .sh 脚本 + .icns 生成 + 三文档 + tauri-overrides 加 macOS icon |

### 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `packages/branding/scripts/build-deskfox.sh` | 新增 ~140 行 | 主入口对称 .ps1。auto-detect host RUST_TARGET、sidecar 缺则自动调 predev.ts、apply → tauri build → restore 三步、产物路径汇报(.app / .dmg / raw binary) |
| `packages/branding/scripts/apply-icons.sh` | 新增 ~100 行 | 对称 .ps1。在 Mac 上额外生成 .icns(调 png-to-icns.sh);同样修 winres 等价 Mac bundle icon 嵌入坑(同步覆盖 dev/icon.{ico,icns})|
| `packages/branding/scripts/restore-icons.sh` | 新增 ~20 行 | 对称 .ps1,git checkout HEAD -- src-tauri/icons/ |
| `packages/branding/scripts/png-to-icns.sh` | 新增 ~70 行 | macOS 内置 iconutil 包装。glob ico-source/<size>.png,按 Apple iconset 命名规范临时拷贝 + 调 iconutil -c icns 出 .icns |
| `packages/branding/tauri-overrides/prod.json` | +1 行 | bundle.icon 数组加 `icons/prod/icon.icns`(Mac bundle 引用) |
| `packages/branding/src/assets/icons/prod/ico-source/{512,1024}.png` | 新增 2 个 binary | 从 source 拷,.icns 完整需要这两档 |
| `packages/branding/src/assets/icons/beta/ico-source/{512,1024}.png` | 新增 2 个 binary | 同上,beta 也补全 |
| `docs/features/macos-打包/{1-spec,2-plan,3-changelog}.md` | 新增 3 文档 | Medium 规模三文档全要 |

无上游文件改动 → 无 FORK marker 增量。

### 设计决策(详见 [1-spec.md](./1-spec.md))

- sidecar 选 **B 本地 build** — 上游 predev.ts 自动按平台 bun --compile,无外部依赖
- icon.icns 用 macOS 内置 **iconutil**,无 brew 依赖
- 不签名、不公证、仅 arm64、不 universal — 跟 Windows 策略对称
- icon 嵌入坑主动防范 — apply-icons.sh 同步覆盖 dev/icon.{ico,icns}(等价 winres 修复)

## Phase 2 实战(2026-04-29,Mac 上首次 build)

操作步骤照 [2-plan.md](./2-plan.md) Step 0-5 走通,scaffolding 经实战检验**可直接用,无阻塞性踩坑**。

简版回顾:

```bash
# 装环境一次性
xcode-select --install && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
curl -fsSL https://bun.sh/install | bash

# clone + 装依赖 + build
git clone https://gitee.com/zoulukuang/opencode-for-office-deskfox.git ~/projects/opencode-fork
cd ~/projects/opencode-fork && git checkout feat/editable-file-viewer
bun install
bash packages/branding/scripts/build-deskfox.sh -Env prod

# 验证启动
xattr -cr packages/desktop/src-tauri/target/release/bundle/macos/DeskFox.app
open packages/desktop/src-tauri/target/release/bundle/macos/DeskFox.app
```

## 走过的弯路 / 中途调整

Phase 2 实战 user 反馈"已经可以打包了",未细记具体坑(若有也是小坑,user 自己处理掉了)。

主要预判防范都生效:
- ✅ sidecar 自动 build(选项 B,上游 predev.ts 复用)— 跑通
- ✅ icon.icns iconutil 现场生成 — 跑通
- ✅ Tauri Mac bundle icon 嵌入坑 — apply-icons.sh 主动同步覆盖 dev/icon.icns 防范,实测嵌入正确(若 Mac bundle 也有等价 winres 坑,主动防范命中,无症状即"已防住";若实际 Mac bundle 不存在该坑,防范也无害)

> 若以后有 Mac 端新坑(如 Apple 某次 OS 升级 / Tauri 升级引入回归),回头补在本段。

## Phase 2 产物(预期)

| 产物 | 路径 |
|---|---|
| raw binary | `packages/desktop/src-tauri/target/release/DeskFox` |
| .app bundle | `packages/desktop/src-tauri/target/release/bundle/macos/DeskFox.app` |
| .dmg 分发包 | `packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox_1.14.21_aarch64.dmg` |
| sidecar | `packages/desktop/src-tauri/sidecars/opencode-cli-aarch64-apple-darwin` |

## 影响范围

- **代码**:0(纯 build 脚本 + 文档 + 资源)
- **运行时**:无(scaffolding 不影响现有 Windows 链路)
- **build 流程**:Windows .ps1 链路完全不动;Mac/Linux 多了 .sh 链路
- **上游侵入率**:无变化(0 个上游文件改动)

## 回退方法

```bash
git revert <phase-1-commit>
# 或手动:
rm packages/branding/scripts/{build-deskfox,apply-icons,restore-icons,png-to-icns}.sh
rm packages/branding/src/assets/icons/{prod,beta}/ico-source/{512,1024}.png
# 还原 prod.json bundle.icon 去掉 .icns 行
rm -rf docs/features/macos-打包/
```

## 后续(留作 future)

- **Phase 2** — user Mac 上首次 build,踩坑修补,3-changelog 回填
- **Phase 3** — 出可分发 .dmg,丢给 Mac 用户测;考虑要不要做 universal binary 兼容 Intel
  - **打 .dmg 时遵守 [installer-versioning](../installer-versioning/) 版本号规则**:`YYYY.M.D.N`,Mac 端跑 `bump-installer-version.ps1 -Platform macOS`(或后续补 `bump-installer-version.sh`)拿到 `[macOS] YYYY.M.D.N` — Win / Mac N 计数器**各自独立**,不共享
- **Linux 等价**:build-deskfox.sh 已经在 Linux 路径下能跑(detect_rust_target 含 Linux),需要时跑一下出 .deb / .rpm
- **Mac signing**:如果 user 真有需要分发给生人(Gatekeeper 拦不掉时),买 Apple Developer ID + Notarize
- **CI 自动出 Mac 包**:GitHub Actions 加 macos-latest runner 跑 build-deskfox.sh,产物上传 release artifact

## 经验沉淀

| 启示 | 落实位置 |
|---|---|
| 上游 sst/opencode 已设计了 sidecar build 自动化(predev.ts + utils.ts),fork 直接复用,不要重写 | 本文 + build-deskfox.sh 第 0 步 |
| Mac iconutil 是 macOS 内置工具,无依赖 | png-to-icns.sh 注释 |
| Tauri 2.10.1 winres / mac bundle 嵌入 .icon 都疑似无视 --config override(Windows 已实证),Mac 主动同步 dev/ 防范 | apply-icons.sh 注释 + 1-spec.md |
