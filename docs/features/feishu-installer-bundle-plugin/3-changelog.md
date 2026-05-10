---
feat-id: feishu-installer-bundle-plugin
status: done
related: ./3-changelog.md
---

# feishu-installer-bundle-plugin — changelog

## 一句话

补完 `feishu-bridge-ship-packaging` Win 端的最后一个 ship-blocker — Inno Setup `.iss` 没列 plugin/feishu-bridge/ 目录,prod installer 装到 user 机器后 `C:\Program Files\DeskFox\` 没 plugin/ 子目录,DeskFox 启动时 `feishu_plugin_install.rs` 找不到 plugin → 飞书桥接 UI 显示"未启动"。本笔加 .iss `[Files]` 段 2 行 Source 把 plugin 打入 install dir。

> Tiny:1 文件 / 5 行 / 0 R4 / 0 上游侵入。

## commit 列表

| commit | 简述 |
|---|---|
| `39e487f75` | `fix(installer): Win Inno Setup .iss 加飞书 plugin bundle + bump 2026.5.10.1`(主 commit + 副带版本 bump)|
| `<merge>` | 跟 `feishu-bridge-empty-reply-ghost` 同分支链合并到 dev |

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/branding/installer/DeskFox.iss` | 改 | `[Files]` 段加 2 行 Source(`plugin\feishu-bridge\package.json` + `plugin\feishu-bridge\dist\plugin.js`)+ AppVersion bump 2026.5.9.1 → 2026.5.10.1 |
| `packages/branding/installer-versions.json` | 改 | windows 版本号 bump |
| `docs/installer-versions.md` | 改 | 加 2026.5.10.1 placeholder(测试通过后填实测笔记)|

## 根因

`feishu-bridge-ship-packaging` 主笔(Mac dev 写)只动了 `tauri.conf.json` 的 `bundle.resources`,让 **Tauri 自带的 NSIS bundler** 把 plugin 打入 .app/.exe。但本仓 Win 端用 **Inno Setup**(`packages/branding/installer/DeskFox.iss`),`.iss` 是独立配置,Mac 那笔没补 [Files] 段。结果:

1. `target/release/plugin/feishu-bridge/{package.json,dist/plugin.js}` 由 `build-deskfox.ps1` step 0.5(调 `build-feishu-plugin.ps1`)+ tauri.conf.json bundle.resources 复制就位 ✓
2. ISCC 编译 installer 时 `[Files]` 只 3 行(`DeskFox.exe` + `opencode-cli.exe` + `opencode_lib.dll`),plugin/ 整个目录**不进** setup.exe ❌
3. 装完 `C:\Program Files\DeskFox\` 没 plugin/ 子目录
4. DeskFox 启动 → `feishu_plugin_install::resolve_plugin_dir` 走 `app.path().resource_dir().join("plugin/feishu-bridge")` → 路径不存在,`is_dir()` false → 返 None → log `[feishu-plugin] resource plugin dir not found, skip injection`
5. user opencode 配置不被注入 → sidecar 启动不加载 plugin → 飞书桥接 UI 走 `adapterReady === false` 分支显示"未启动"警告(跟修 ship-packaging 之前一模一样)

## 修法

`packages/branding/installer/DeskFox.iss` `[Files]` 段加:

```
Source: "{#ReleaseDir}\plugin\feishu-bridge\package.json";    DestDir: "{app}\plugin\feishu-bridge";      Flags: ignoreversion
Source: "{#ReleaseDir}\plugin\feishu-bridge\dist\plugin.js";  DestDir: "{app}\plugin\feishu-bridge\dist"; Flags: ignoreversion
```

结构跟 Mac NSIS bundle 对齐(install dir 平铺 `plugin/feishu-bridge/{package.json,dist/plugin.js}`),runtime `feishu_plugin_install.rs:51-58` 走 `app.path().resource_dir()` 拿到 install dir(Win Inno Setup 装的是 `C:\Program Files\DeskFox\`)后 join `plugin/feishu-bridge` 命中。

## 验证

### Build 层

重 pack 后 ISCC log 显示 5 文件压缩(原 3 + 新 2):

```
Compressing: ...DeskFox.exe
Compressing: ...opencode-cli.exe
Compressing: ...opencode_lib.dll
Compressing: ...plugin\feishu-bridge\package.json    ← 新
Compressing: ...plugin\feishu-bridge\dist\plugin.js  ← 新(3.4MB → lzma2 压缩)
```

installer size: 61,279,699 → 61,462,332 bytes(+178KB,plugin.js 压缩后增量)。

### user 实测

- ✅ user 装 `DeskFox-2026.5.10.1-setup.exe`
- ✅ 应用程序网格显示 "DeskFox"(prod,不是 "DeskFox Dev")
- ✅ 启动后设置 → 飞书桥接 → 直接看到 "添加飞书账号" 空态(不是 "未启动" 警告)
- ✅ `~/.config/opencode/opencode.jsonc` 自动注入 `plugin: ["file:///C:/Program%20Files/DeskFox/plugin/feishu-bridge"]`

## 教训

跨平台 ship 路径不能假设"一种打包格式做完了别的也跟着做完"。Tauri NSIS bundler(Mac/默认)和 Inno Setup(本仓 Win 自定义)是两套独立配置:

| 资源声明 | NSIS / Tauri | Inno Setup |
|---|---|---|
| 配置文件 | `tauri.conf.json` `bundle.resources` | `DeskFox.iss` `[Files]` 段 |
| 同步状态 | Mac dev 改了 ✓ | 漏了 ❌(本笔补)|

后续任何往 install dir 加资源的改动都要同步动两处。

## R4 / 上游侵入

- 0 R4 override
- 0 上游侵入

## 跟进

`feishu-bridge-ship-packaging/3-changelog.md` 加 Follow-up #2 注,指向本 feat-id。
