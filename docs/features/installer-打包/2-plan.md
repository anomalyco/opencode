---
feat-id: installer-打包
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# installer-打包 — plan

## 当前位置(2026-04-28 重启前 handoff)

**正在 Step 1 — 装 Inno Setup**,卡在管理员权限。user 准备重启电脑。

**已完成**:
- ✅ DeskFox raw exe 已构建:`packages/desktop/src-tauri/target/release/DeskFox.exe`(~26MB,prod env,2m07s)
- ✅ Tauri NSIS 路径排查闭环(3 次失败 → 放弃,详见 1-spec.md)
- ✅ 决策选 Inno Setup
- ✅ git working tree 干净(尝试中改的 tauri.conf.json + tauri-overrides/prod.json 已 revert)

**待办**:
- ⏳ Step 1:装 Inno Setup(blocking)
- ⏳ Step 2:写 `.iss` 脚本
- ⏳ Step 3:iscc 编译
- ⏳ Step 4:user 在干净机器(或本机)验证安装

## 实施步骤

### Step 1 — 装 Inno Setup(blocking,等 user 重启后)

choco install 命令行需要管理员权限,user 没提权时 `choco install innosetup -y` 静默失败:
```
Chocolatey installed 0/0 packages.
路径"C:\ProgramData\chocolatey\lib-bad"的访问被拒绝。
```

**重启后选一条做**:

**做法 A — choco 提权安装**:user 用管理员身份打开 PowerShell,跑:
```powershell
choco install innosetup -y
```
choco 默认装到 `C:\Program Files (x86)\Inno Setup 6\`,iscc.exe 自动在那。

**做法 B — 手动下载装到 D 盘(user 已表达想装 D 盘)**:
1. 下载 https://jrsoftware.org/download.php/is.exe(~3-5MB)
2. 双击运行(会要 UAC 提权一次)
3. 在 "Select Destination Location" 步骤 Browse 到 `D:\Inno Setup 6`(或其他 D 盘路径)
4. 一路 Next 装完,iscc.exe 在选定的 D 盘路径里

**做法 C — 让我代下载到临时目录,user 双击装**:
我用 `Invoke-WebRequest` 把 is.exe 下到 `D:\tmp\` 之类,user 双击运行 GUI 选路径装。

无论哪条,**装完后**告诉我 `iscc.exe` 的绝对路径,Step 2 就能开始。

### Step 2 — 写 `.iss` 脚本

新建文件:`packages/branding/installer/DeskFox.iss`(fork-only 路径,跟 branding 资源同级)

最小 `.iss` 包含:
- `[Setup]` 段:AppName / AppVersion / DefaultDirName(默认 `{autopf}\DeskFox`)/ DefaultGroupName / OutputBaseFilename
- `[Files]` 段:把 `DeskFox.exe` + sidecar `opencode-cli.exe` + 必要的 dll(WebView2 不打,系统装)拷进来
- `[Icons]` 段:桌面 + 开始菜单快捷方式
- `[UninstallDelete]` 段:卸载时清理 user data(如有)
- (可选)`[Code]` 段:WebView2 runtime 检测,缺失时弹链接

参考路径:
- `DeskFox.exe`: `packages\desktop\src-tauri\target\release\DeskFox.exe`
- sidecar: `packages\desktop\src-tauri\sidecars\opencode-cli*.exe`(check 实际命名)
- 图标:`packages\branding\src\assets\icons\prod\icon.ico`
- ! 取版本号:`package.json` 的 `version` 字段(或更上层的 monorepo root)

### Step 3 — 编译

```powershell
& "<iscc.exe 路径>" "D:\project\opencode-fork\packages\branding\installer\DeskFox.iss"
```

产物:`<同目录>\Output\DeskFox-<version>-setup.exe`(或 .iss 里 OutputDir 配置的位置)

### Step 4 — 验证

user 双击 setup.exe → SmartScreen 弹"未知发布者" → 点"更多信息 → 仍要运行"→ 安装向导 → 装完 → 桌面快捷方式启动 → 行为与 raw `DeskFox.exe` 一致。

最好在另一台干净机器(没装过任何 OpenCode/DeskFox 的)验证,模拟用户体验。

### Step 5 — 后续(本次不做,留作 future)

- 把 iscc 调用包进 `build-deskfox.ps1` wrapper,加 `-Installer` 参数
- 或单独写 `package-installer.ps1`,build → iscc 一条龙
- 给 installer 出版本号 → release tag → upload 到分发渠道(GitHub Releases / 自建 OSS / 微信群)

## 决策轨迹

| 决策点 | 选项 | 取舍 | 理由 |
|---|---|---|---|
| installer 工具 | A. Tauri NSIS / B. Inno Setup / C. WiX(.msi) / D. 不打,绿色 zip | B | A 卡 signtool;C 太重(MSI 是企业场景);D 体验差;B 老牌、轻、自由度高 |
| 是否签名 | 签 / 不签 | 不签 | 当前不投资证书成本,SmartScreen 提示是预期 |
| Inno Setup 装哪 | C 盘 / D 盘 | D 盘(user 倾向)| user 表达过 C 盘空间紧 |
| 是否打 sidecar 进 installer | 打 / 不打 | 打 | sidecar 是必需运行时,raw exe 也带它 |
| WebView2 runtime | 内嵌 / 提示外装 | 提示外装 | 内嵌包大幅膨胀(~160MB),Win10/11 都内置,提示用户即可 |

## 风险

- **Inno Setup .iss 写错路径**:第一轮编译会暴露,quick fix。低风险
- **sidecar 路径与命名**:Tauri 编译产物里的 sidecar 命名规范要确认(可能带 target-triple 后缀如 `opencode-cli-x86_64-pc-windows-msvc.exe`),写 .iss 前先 ls 确认
- **图标 .ico 格式**:Inno Setup 用的 `.ico` 文件,需要包含 16/32/48/256 多分辨率。`packages/branding` 里现有 `.ico` 是 build-deskfox.ps1 生成的,应该 OK,但要确认
- **回退**:无 git 改动,删 `.iss` 文件就回到当前状态。低风险

## 预算

| 项 | 行数 |
|---|---|
| `packages/branding/installer/DeskFox.iss`(新文件)| ~50-100 行(含注释) |
| `docs/features/installer-打包/{1-spec,2-plan,3-changelog}.md` | ~200-300 行 |
| `INDEX.md` 索引 | +1 行 |
| **新文件不计入 staged 阈值** | |

无代码修改,只新增 `.iss` 脚本 + 文档。

## 走过的弯路 / 中途调整

(已记录在 1-spec.md "为什么不用 Tauri NSIS" 段:Tauri 2.10.1 NSIS bundle 三次踩 signtool 坑,放弃)

## 重启后 resume 提示给下一会话

1. **cwd**:user 应该已在 `D:\project\opencode-fork`(memory `feedback_opencode_fork_cwd.md`)。如果不是,先 `cd D:\project\opencode-fork`
2. **首先做的事**:问 user "Inno Setup 装好了吗?装在哪个路径?",拿到 iscc.exe 绝对路径后开始 Step 2
3. **如果 user 还没装**:看 Step 1 三种做法,推荐"做法 B 手动下载装 D 盘"(user 已表达过)
4. **跳过的诱惑**:别去重新尝试 Tauri NSIS 路线 — 1-spec.md 写明了三次失败原因,不要重复踩
5. **git 状态**:除了本目录的三个新 doc 文件,工作树应该是干净的。如果发现别的脏改动,先 `git diff` 看清楚再决定
