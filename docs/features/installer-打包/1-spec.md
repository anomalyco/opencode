---
feat-id: installer-打包
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# installer-打包 — spec

## 触发原因

把 DeskFox 打成对外可分发的 Windows installer(不签名)。当前 build 产物只有 `DeskFox.exe`(~26MB,raw exe),要给外部人用需要:
- 标准 Windows 安装体验(双击 → Next → 完成)
- 自动建快捷方式 / 卸载入口
- 把 sidecar `opencode-cli.exe` + WebView2 依赖一起处理

user 选了"档 B installer 不签名"路线 — 不投入代码签名证书(成本与时间都不值得现阶段)。

## 验收标准

- [ ] installer .exe 产物在干净 Win10/11 机器双击能装上(SmartScreen 警告可接受 — 不签名预期会有,user 点"仍要运行"即可)
- [ ] 装完桌面 / 开始菜单有 DeskFox 快捷方式
- [ ] 控制面板能看到"DeskFox"卸载入口
- [ ] 双击桌面快捷方式启动 DeskFox 行为与 raw `DeskFox.exe` 一致
- [ ] 安装包包含 sidecar `opencode-cli.exe`,启动时能正确 spawn
- [ ] WebView2 runtime:Win10/11 内置,如果机器没有,installer 提示去微软下载(或自动拉)

## 不做什么

- **不签名** — 不买 OV/EV 证书,不启用 Tauri 签名链路。SmartScreen 警告是预期成本
- **不做 auto-update** — `禁自动升级` feat 已落地,这版固定就这版,以后换版本再发新 installer
- **不出 .msi** — `.exe` 安装包足够,.msi 通常给企业 GPO 推送,DeskFox 当前用户场景用不上
- **不做多语言安装界面** — Inno Setup 默认带英中文,不专门定制

## 架构选型

走"**Inno Setup 完全绕开 Tauri NSIS**"。

### 为什么不用 Tauri NSIS

`build-deskfox.ps1 -Env prod`(去掉 -NoBundle)走 Tauri 的 `tauri build` → NSIS bundler。**踩了 3 次坑,全部卡在 "SignTool not found"**:
1. 默认 build:Tauri 找不到 Windows SDK 的 signtool.exe → bundle 阶段挂
2. fork-only override 把 `signCommand` 改成 `cmd /c exit 0`(no-op):**Tauri 仍报 SignTool not found**,override 没生效或 NSIS bundle 走独立 signtool 检查路径
3. 直接改 base config `tauri.conf.json` 同样 no-op signCommand:**仍报 SignTool not found**,确认 Tauri 2.10.1 的 NSIS bundle 不尊重 signCommand 配置(或有独立 signtool 必需检查)

结论:Tauri 2.10.1 的 NSIS bundle 是黑盒,本地没 signtool 就是过不去。要继续走这条路只能装 Windows SDK(~几 GB),且装完仍可能踩其他坑。**放弃**。

### 为什么 Inno Setup 是合理替代

- **不需要 signtool** — Inno Setup 自己处理 installer 编译,与微软 SDK 无关
- **完全可控** — 我们写 `.iss` 脚本,100% 控制安装流程,不依赖 Tauri 黑盒
- **小** — 装完 ~7-10MB,可放任意目录(包括 D 盘)
- **稳** — Inno Setup 自 1997 年起,Windows 老牌 installer 工具,不会被 Tauri 升级搞挂
- **iscc 命令行编译** — 适合纳入 build pipeline,后续每次发布跑一行命令出 installer
