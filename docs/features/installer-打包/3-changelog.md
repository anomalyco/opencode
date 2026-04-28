---
feat-id: installer-打包
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# installer-打包 — changelog

## 一句话

DeskFox 打成 Windows installer 走 Inno Setup 6 路线(Tauri NSIS 因 SignTool 黑盒放弃);打包过程顺手修了一个潜伏 fork 的 icon pipeline bug,让 release exe 真正嵌入多分辨率狐狸图标。

## 改动文件

| 文件 | 性质 | 行数 / 备注 |
|---|---|---|
| `packages/branding/installer/DeskFox.iss` | 新增 | ~80 行 — Inno Setup 主脚本 |
| `packages/branding/installer/ChineseSimplified.isl` | 新增(三方下载) | 21KB — 从 issrc 仓拉的官方非官方简中语言包(choco 装的精简 Inno 不带) |
| `packages/branding/installer/Output/` | 新增(产物,gitignore) | iscc 编译输出 |
| `packages/branding/scripts/apply-icons.ps1` | 修 | ~15 行 — png-to-ico 输入从硬编码 16/32/48 改成 glob 扫 ico-source/`<size>.png` |
| `packages/branding/tauri-overrides/prod.json` | 修 | +5 行 — 加 `bundle.icon` 覆盖,指向 `icons/prod/...`,否则 Tauri 用 base config 的 `icons/dev/` 嵌的是上游 OpenCode 图标 |
| `packages/branding/src/assets/icons/prod/ico-source/64.png` | 新增 | 从 `D:\Kbase\奇思妙想\opencode\品牌设计\png\icon-primary\` 拷 |
| `packages/branding/src/assets/icons/prod/ico-source/128.png` | 新增 | 同上 |
| `packages/branding/src/assets/icons/prod/ico-source/256.png` | 新增 | 同上 |
| `packages/branding/src/assets/icons/prod/ico-source/48.png` | 删 | 原文件 MD5 = 64.png,文件名骗人(实际是 64×64),会让 ico 出现重复尺寸 |

无上游文件改动 → 无 FORK marker 需求,不算上游侵入率。

## commit 列表

| commit | 简述 |
|---|---|
| `1523ea963` | `fix(branding): icon pipeline 修` — apply-icons.ps1 改 glob、prod.json 加 bundle.icon override、ico-source/{64,128,256}.png 加、骗人的 48.png 删 |
| `0236481cb` | `feat(installer): DeskFox Inno Setup 打包 + 简中语言包` — DeskFox.iss + ChineseSimplified.isl + .gitignore + 三文档 + INDEX/改动日志 索引 |

两笔分开,各自独立可 revert(走方案 A,理由见 1-spec/2-plan)。

## 验收结果

- [x] installer .exe 产物可双击装上(SmartScreen "未知发布者"提示按预期出现,user 选"仍要运行")
- [x] 装完桌面 / 开始菜单出现 DeskFox 快捷方式
- [x] 控制面板出现 DeskFox 卸载入口,图标是狐狸
- [x] 双击桌面快捷方式启动 DeskFox 行为与 raw `DeskFox.exe` 一致
- [x] 安装包自带 sidecar `opencode-cli.exe`,启动正确 spawn
- [x] WebView2 检测:[Code] 段查注册表,缺失时弹微软下载链接(本机已有,未触发)
- [x] **桌面快捷方式图标显示狐狸**(需清 Windows icon cache,见下"踩坑")

## 走过的弯路 / 中途发现

### 弯路 1:Tauri NSIS bundle 三次卡 SignTool(本次没碰,1-spec.md 已记)

略,见 `1-spec.md` "为什么不用 Tauri NSIS"。

### 弯路 2:choco 装的精简版 Inno Setup 不带简中语言包

第一次 iscc 报 `Couldn't open include file "...\Languages\ChineseSimplified.isl"`。choco 的 innosetup package 砍了 Languages/ 下的非默认语言文件(默认只有英文 + 西欧)。

修法:从 `https://github.com/jrsoftware/issrc/raw/main/Files/Languages/Unofficial/ChineseSimplified.isl` 拉一份放 `packages/branding/installer/ChineseSimplified.isl`,改 .iss 用相对路径引用。仓内自带,以后换装环境也能 build。

### 弯路 3(真正大坑):Tauri build 嵌的 .ico 不是 DeskFox 狐狸,是上游 OpenCode 图标

第一版 installer 装出来后 user 反馈"桌面快捷方式 logo 是 OpenCode 不是 DeskFox"。排查链:

1. 看 `tauri.conf.json` → `bundle.icon` 写死 `icons/dev/...`
2. 看 `apply-icons.ps1 -Env prod` → 把 prod 资产拷到 `icons/prod/`
3. **Tauri 不读 prod 目录**,winres 嵌的是 `icons/dev/icon.ico`(restore-icons.ps1 还原后那是上游 OpenCode 默认图标)

修法:`tauri-overrides/prod.json` 加 `bundle.icon` 数组,指向 `icons/prod/...`,Tauri --config 走 deep merge,只替换 icon 数组。

⚠️ **同样的 bug 还潜伏在 beta env**:`tauri-overrides/beta.json` 也没 `bundle.icon` 覆盖,beta build 同样会嵌上游图标。本次没修(没在用 beta 包),记一笔以后处理。

### 弯路 4:exe 嵌的 .ico 只有 16/32 两档 → Windows 桌面 48px 显示异常

修完弯路 3,验证 exe 里嵌的图标 — 只有 16/32 两档(`PrivateExtractIcons` 拉 48/64/128/256 都返回缩放过的)。原因:`apply-icons.ps1` 调 `png-to-ico.ts` 时硬编码只传 `ico-source/{16,32,48}.png`,且 `48.png` 文件实际是 64×64(MD5 跟新拷的 64.png 完全相同)。

Windows 桌面默认中图标视图 48px,缺这档时系统硬缩 32→48 严重模糊,加上有上一版安装的 cache 残留,看起来像"完全错的图标"。

修法:apply-icons.ps1 改成 glob 扫 `ico-source/*.png`(文件名 = 尺寸,如 `16.png` / `256.png`),按尺寸升序全部喂给 png-to-ico.ts;删除骗人的 48.png;从源仓拷 64/128/256 进来。最终 ico 5 档(16/32/64/128/256),exe 嵌入验证通过。

### 弯路 5:Windows icon cache 卡死,装新版桌面 shortcut 还显示老图标

修完弯路 4 + 重装 installer,**控制面板 + installer 自身图标全对**,但 user 报**桌面快捷方式还是 OpenCode 图标**。

排查:看 `iconcache_*.db` 文件 mtime — `iconcache_48.db` 21MB,**18:06 更新**(早于 18:53 的新 exe build)。Windows 的 icon cache 按"路径 + (有时是 mtime/identity)"为 key,同路径覆盖装时不主动 invalidate;重启 explorer 进程**不够**,要删 cache 文件。

修法:

```powershell
Stop-Process -Name explorer -Force
Remove-Item "$env:LocalAppData\Microsoft\Windows\Explorer\iconcache_*.db" -Force
Remove-Item "$env:LocalAppData\Microsoft\Windows\Explorer\thumbcache_*.db" -Force
Start-Process explorer
```

执行后 user 立即确认狐狸图标显示正常。**已存为 feedback memory** — 下次 DeskFox 改图标后 shortcut 不更新,直接走这条命令,别再重启 explorer 了。

## 影响范围

- **代码**:无;纯打包脚本 + branding 资产
- **运行时**:无;不改 DeskFox.exe 自身行为
- **build 流程**:apply-icons.ps1 改后 ico 多分辨率默认 5 档(prod);dev/beta env 不受影响(它们 ico-source/ 还是 16/32/48,glob 出 3 档照旧工作)
- **上游侵入率**:无变化(0 个上游文件改动)

## 回退方法

完全回退(放弃 installer + icon 修复):

```bash
git revert <icon-pipeline-fix-commit> <installer-打包-commit>
```

或部分回退(只去 installer,留 icon 修复):

```bash
git revert <installer-打包-commit>
rm -rf packages/branding/installer/Output/
```

或部分回退(去 icon 修复,留 installer scaffold — 但 installer 装出来图标会错):不推荐,但理论可行 `git revert <icon-pipeline-fix-commit>`。

## 后续(留作 future)

- **beta env 同样的 icon 修复**:`tauri-overrides/beta.json` 加 `bundle.icon` → `icons/beta/...`,beta ico-source/ 也补 64/128/256(从 `D:\Kbase\奇思妙想\opencode\品牌设计\png\icon-mono\` 拷)。本次跳过,等真正用 beta 包时再修
- **build 脚本一条龙**:写 `package-installer.ps1` 串 `build-deskfox.ps1 -Env prod -NoBundle` + `iscc DeskFox.iss`,免每次手动两步
- **版本号自动注入**:目前 .iss 硬写 `1.14.21`,改成从 `packages/desktop/package.json` 读再 `iscc /DAppVersion=...`
- **CI 一键发布**:Github Action 跑 build + iscc + 上传 release artifact
