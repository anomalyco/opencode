---
feat-id: macos-打包
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# macos-打包 — spec

## 触发原因

DeskFox 当前只出 Windows installer。user 有 Mac M 系列,想打 macOS 版本。Tauri 原生支持 Mac bundle(`.app` + `.dmg`),技术路径成熟。

## 验收标准

**Phase 1(本仓内 scaffolding,可在 Windows 完成,本次)**:

- [ ] 写完 Mac 版 build pipeline 脚本对称 Windows .ps1 三件套
- [ ] sidecar 路径策略明确(自给自足,本地 build,跟上游 predev.ts 接轨)
- [ ] icon.icns 生成路径明确(macOS 自带 iconutil,无外部依赖)
- [ ] tauri-overrides/prod.json 加 macOS 字段
- [ ] 文档(本三文档)写完

**Phase 2(user Mac 上验证,后续)**:

- [ ] Mac 上 clone 仓 + 装环境(rustup + bun + Xcode CLI Tools)
- [ ] 跑 `bash packages/branding/scripts/build-deskfox.sh -Env prod` 出 `.app` + `.dmg`
- [ ] 双击 `.dmg` → 拖 `DeskFox.app` 到 Applications → 首次右键 → 打开 → 能跑起来
- [ ] DeskFox.app 行为与 Windows 版一致(file viewer / chat 等核心功能能用)
- [ ] sidecar `opencode-cli-aarch64-apple-darwin` 正确 spawn,不报路径错
- [ ] 任务栏 / Dock / 窗口 icon 显示 DeskFox 狐狸(可能要解决 Mac 版 icon 嵌入坑,等价 Windows winres 那个)

## 不做什么

- **不签名 / 不公证(notarize)** — 跟 Windows 同策略,不投资 Apple Developer ID($99/年);user 首次打开 Gatekeeper 会拦,**右键 → 打开 → 仍要打开** 可绕。分发给别人时他们也得手动绕一次
- **不做 Intel x86_64 版** — user 是 Apple Silicon M 系列;若以后真要支持 Intel,加 `-Env prod --target=x86_64-apple-darwin` 或单独 build 一份。当前不做 universal binary(双架构合一,体积翻倍)
- **不做 auto-update** — 跟 Windows 同策略,固定版本,换版本发新 .dmg
- **不做 mas / App Store** — 没意义,Apple 审核流程不值
- **Linux 暂不打** — 虽然 build-deskfox.sh 兼容 Linux 路径,但目前 user 没 Linux 用例,先不验证

## 架构选型

### sidecar 来源 — 选 B(本地 build,跟上游 predev.ts 接轨)

**A. 从 sst/opencode upstream releases 下载** — 依赖上游 release scheme 稳定;upstream 改命名 / 频率 fork 跟着断。**淘汰**

**B. 本地 build(选)** — `packages/desktop/scripts/predev.ts` 已有完整逻辑:`bun run build --single` in `packages/opencode/` 自动按平台编译,然后 `copyBinaryToSidecarFolder` 拷到 `src-tauri/sidecars/opencode-cli-<rust-target>`。Mac 上设 `RUST_TARGET=aarch64-apple-darwin` 跑同一脚本即出 Mac sidecar。**版本永远跟源码绑定,无漂移**。是上游设计的标准路径。

**C. 从 OpenCode.app 抠 sidecar** — 脏 + 法律灰 + Apple bundle 内部布局可能变。**淘汰**

> 选 B 的代价:Mac 上 build 时多 1-3 分钟 sidecar 编译(bun build --single 是 bun --compile,opencode-cli 现在 161MB,Mac 版相近,首次编译稍慢)。可接受。

### icon.icns 生成 — 选 macOS 内置 iconutil

`iconutil` 是 Xcode CLI Tools 自带,无外部依赖。流程:

1. 准备 `<size>.png` 集合(16/32/64/128/256/512/1024)
2. 按 Apple iconset 命名规范拷到临时 `.iconset/` 目录(如 `icon_512x512@2x.png` ← 1024.png)
3. `iconutil -c icns icon.iconset -o icon.icns`

替代方案:用 `sips` 单档 resize + 手动拼。但 iconutil 更标准。淘汰。

### bundle 格式

Tauri Mac 默认产 `.app`(应用 bundle)+ `.dmg`(磁盘映像)。两个都给 user,`.app` 拖 Applications,`.dmg` 用于分发(分发给别人时给 .dmg)。当前 `tauri.conf.json` `bundle.targets` 包含 `["dmg", "app"]`,默认行为已对,prod.json 不用覆盖 targets。

### bundle identifier — 暂沿用 base

base config `tauri.conf.json` `identifier = "ai.opencode.desktop.dev"`。

Mac 上 identifier 决定:
- `~/Library/Application Support/<identifier>/` — app data 目录
- Dock 图标 / Launchpad 注册 key

跟 Windows 同策略,不专门 override(改了影响 WebView state 共享 + 跟 sst/opencode 官方版可能撞)。如果以后撞了,prod.json 加 `"identifier": "ai.deskfox.desktop"` 就行。

### Tauri Mac bundle icon 嵌入坑(预期 + 已防范)

Windows 验证过 `--config prod.json` 的 `bundle.icon` override **完全无视**,winres 实际只读 `icons/dev/icon.ico`(详见 [icon-pipeline-deep-fix/3-changelog.md](../icon-pipeline-deep-fix/3-changelog.md))。

**Mac 大概率同坑** — Tauri 2.10.1 的 macOS bundle pipeline 内部可能也是早期 resolve base config icon 路径,override 应用在那之后。

**已在 apply-icons.sh 主动防范**:`-Env prod/beta` 时同步覆盖 `icons/dev/icon.icns`(与 .ico 同处理),让 Mac bundle 无论读哪份都拿到 prod 资源。等 user Mac 上首次 build 验证假设是否成立,若不成立可移除冗余拷贝。
