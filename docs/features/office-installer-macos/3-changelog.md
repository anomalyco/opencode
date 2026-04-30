---
feat-id: office-installer-macos
status: done
related: ./3-changelog.md
---

# office-installer-macos — changelog

**关联 commit**: `fc69b462c`
**所在分支**: `feat/editable-file-viewer`
**规模**: Tiny(2 文件 净 +119 / -48,无 1-spec / 2-plan)
**触发原因**: `66c8fa523`(2026-04 初版 office 文档预览)落地时只支持 Windows 自动安装 LibreOffice(`msiexec /i ...msi`),macOS 用户点"安装预览插件"会撞 `platformSupported = false`,只能手动装。本次补 macOS 自动安装通道:DMG 下载 → `hdiutil` 挂载 → `cp -R` 到 `~/Applications` → 自动检测 soffice。

## 实际改动

### `packages/opencode/src/file/office-installer.ts`(+118 / -47)

#### `buildPathSuffix` — 加 macOS DMG URL pattern

```ts
if (process.platform === "darwin" && (process.arch === "arm64" || process.arch === "x64")) {
  const dir = process.arch === "arm64" ? "aarch64" : "x86_64"
  const suffix = process.arch === "arm64" ? "aarch64" : "x86-64"
  return `${LIBREOFFICE_VERSION}/mac/${dir}/LibreOffice_${LIBREOFFICE_VERSION}_MacOS_${suffix}.dmg`
}
```

兼容 arm64(M 系列)+ x86_64(Intel Mac)双架构。dir / suffix 命名差一字符(`aarch64` 全小写;`x86_64` 在路径里是 `x86_64`,文件名里是 `x86-64`),按 TDF 官方目录规范填。

#### `commonInstallPaths` — 加 macOS soffice 检测路径

```ts
if (process.platform === "darwin") {
  return [
    path.join(home, "Applications/LibreOffice.app/Contents/MacOS/soffice"),
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ]
}
```

`~/Applications` 在前(本用户目录,不需要管理员权限,与下面 install 路径一致),系统 `/Applications` 在后(用户已手动装过的兼容)。原 Win 块用 `if (process.platform === "win32")` 包起来,默认 return [] 改到末尾。

#### `status.downloadSizeMB` — 平台条件

`355 → process.platform === "darwin" ? 281 : 355`。macOS DMG 比 Win MSI 小约 70MB(MSI 含一些 Win 专属运行时),前端 `OfficeInstallPrompt` 显示"约 281 MB"。

#### `startInstall` — install 逻辑分两支

原 Win msiexec 流程裹进 `if (process.platform === "win32") { ... }`,新增 `else if (process.platform === "darwin") { ... }` 分支:

```ts
// 1. 挂载 DMG
hdiutil attach <msiPath> -nobrowse -noautoopen
// 2. 解析挂载点(stdout 最后一行 tab-separated 取最后一段)
// 3. 找 LibreOffice.app(.app 结尾 + name 含 "libre")
// 4. cp -R <DMG>/<app> ~/Applications/<app>(覆盖旧的)
// 5. finally hdiutil detach <mountPoint> -force(无论成功失败都解挂)
```

挂载错误 / app 找不到 / cp 失败都打 `progress.phase = "error"` 配中文 message;DMG 文件名(变量名沿用 `msiPath`,语义上是"已下载的安装包路径",macOS 下实际是 .dmg)与 Win 共用 cache 目录 `Global.Path.cache/office-installer/`,reuse 逻辑沿用(>100MB 视为完整,跳过下载)。

#### 错误文案 `soffice.exe → soffice`

平台中性,Win/Mac 通用。

#### FORK marker

加了三处:`buildPathSuffix` 内 / `commonInstallPaths` 内 / `startInstall` 用 `FORK-BEGIN`...`FORK-END` 包整个分平台 install 块。日期 `2026-04-29`(本机最初写 patch 那天)。

### `packages/ui/src/components/office-install-prompt.tsx`(+1 / -1)

文案 `安装到本用户目录、不需要管理员权限、不弹 UAC 提示` → `安装到本用户目录、不需要管理员权限`。删掉"不弹 UAC 提示"那一句 — UAC 是 Windows 概念,macOS 上没有 UAC,本通用文案不该提。

## 行数

| 项 | 行数 |
|---|---|
| `office-installer.ts` insertions | 118 |
| `office-installer.ts` deletions | 47(主要是 Win msiexec 块从顶级缩进进 if 块,代码本质没删) |
| `office-install-prompt.tsx` | +1 / -1 |
| **代码 staged 净** | **~119 行 insertions** |

Tiny 级,远在 500 阈值内。无 large-diff。

## R4 override 论证(本季第 4 笔,触越 ≤ 2 笔/季健康指标)

**触发**:hook 黑名单仍含 `office-installer.ts` + `office-install-prompt.tsx`(初版 `66c8fa523` 已 override 进入,但路径未从黑名单移除,后续增量仍被拦)。

**配额状况(2026 Q2)**:`66c8fa523` 初版 office / `e2a9d7167` claude-code-loop / `41817499d` plugin-cwd-channel(标"特批不扣下季度")/ **本笔 office-installer-macos** = 4 笔,超 ≤ 2 季度配额 2 笔。下季度补回。

**逐文件 wrapper 不可行性**:

- **`packages/opencode/src/file/office-installer.ts`**:这是 fork 写的"LibreOffice 安装引擎"核心(初版 `66c8fa523` 已落地)。要给它加 macOS 分支,无 wrapper 替代方案 — 在外面套一个 `office-installer-macos.ts` 再调它,需要重写 `progress` 状态机 / `detectSofficePath` / `pickFastestMirror` / 缓存复用整套逻辑(各 ~30-50 行),且两套引擎共享 `Global.Path.cache/office-installer/` 会撞;唯一干净方式是在原引擎内 `if (process.platform === "darwin") { ... }` 分支(本次做的)。
- **`packages/ui/src/components/office-install-prompt.tsx`**:fork 写的安装引导 UI(初版 `66c8fa523` 入仓)。改 1 行文案("不弹 UAC 提示" → 删除,macOS 无 UAC 概念),无法在外层包一层"重写整段文案"(那需要把整个 prompt 组件复制再分平台条件渲染,代价 22 行 → 50 行,且 `OfficeInstallPrompt` 是 export 出去的,fork 一份会让 import 路径分歧)。

**风险评估**:

- Win 行为零变化(`office-installer.ts` 原 Win msiexec 块整体缩进进 `if (win32)`,逻辑零差异;`office-install-prompt.tsx` 文案 Win/Mac 通用)
- macOS 三种失败已覆盖:挂载 / app 找不到 / cp 失败 + finally 解挂
- typecheck 全过(14/14)
- user 实测 R1-R4 通过(macOS arm64 raw binary)

**TODO 治理**:下次单开一笔 `黑名单-治理-office-fork-only`,把这俩 fork-only 文件从 `.husky/pre-commit` 黑名单移除,理由"初版已 override 进入,后续增量改不再有意义重复拦"。本笔不动 hook,先解决眼前 ship 需求。

## 影响范围

- ✅ macOS arm64 / x86_64:点"+ 安装预览插件" → 自动下载 .dmg(国内镜像优先) → 静默装到 `~/Applications/LibreOffice.app` → 自动检测 soffice → 状态变 done
- ✅ macOS 用户已手动装过 LibreOffice 到 `/Applications/`:`commonInstallPaths` 第 2 路径检出,跳过下载
- ✅ Windows:行为完全不变(原 msiexec 路径整块搬进 `if (win32)`,逻辑零差异)
- ✅ Linux:platformSupported = false(`buildPathSuffix` 不返回 path),按既有 UI 回退到"手动安装"提示
- ✅ Office 预览(64 位 .docx / .xlsx 等):macOS 上 LibreOffice 装好后直接生效,与上游 PDF 渲染管线兼容,本 feat 不动渲染
- ⚠️ `~/Applications` 不存在时自动 `mkdir -p` 创建;`hdiutil detach` 在 finally 块,即使 cp 失败也尝试解挂(失败不抛,沉默继续)
- ⚠️ 多版本切换:已存在的 `LibreOffice.app` 会先 `fs.rm -r -f` 再 cp,无版本冲突;但用户自己定制过 `LibreOffice.app`(扩展 / 配置)会被 reset

## 回归测试点

User 在 macOS dev raw binary(`build-deskfox.sh -Env dev --no-bundle`)实测过 — 详细 user 反馈"测试通过":

- **R1** 干净 Mac(无 LibreOffice)→ 点"+ 安装预览插件" → 自动下载 + 装 → status 变 done → ✅
- **R2** 已装 LibreOffice 到 `/Applications/` → 状态直接 done(走 commonInstallPaths 跳过下载)→ ✅
- **R3** 装好后预览 .docx → LibreOffice 转 PDF → pdfjs 渲染 → ✅
- **R4** 镜像选择 — 国内网络下 HEAD 竞速选清华 / 中科大,显示 `progress.mirrorName=清华大学`(office-installer.ts:230 log)→ ✅
- ⏳ Windows 行为未回归测试(改动里 Win 块仅缩进搬位,逻辑零差异;待下次 user 在 Win 端 sanity check)

## review 自检

- [x] 仅触动 fork-only 文件(`packages/opencode/src/file/office-installer.ts` + `packages/ui/src/components/office-install-prompt.tsx`,均为初版 `66c8fa523` 时入仓的 fork 文件)
- [x] FORK marker 加全(三处分平台分支 + 一处 FORK-BEGIN/END)
- [x] git diff insertions ≈ 119 行,Tiny 阈值内
- [x] 无新增依赖(用系统自带 `hdiutil` / `cp` / Bun 内置 `fetch`)
- [x] 错误处理覆盖三种 macOS 失败:挂载失败 / app 找不到 / cp 失败 + finally 解挂
- [x] `~/Applications` mkdir 防御 + 旧 .app 先删后拷,避免 cp -R 进已有目录的语义陷阱
- [x] typecheck 全过(14/14)
- [x] User 实测通过

## 回退方法

```
git revert <code commit hash>
```

新增 macOS 分支,纯增量。revert 后 macOS 用户重新撞 `platformSupported = false`,Windows 行为不变。无 schema / 无服务端 / 无依赖。

## 备注

- 变量名 `msiPath` 在 macOS 分支里语义上是 .dmg 路径,沿用以避免分平台变量名分歧 / cache 目录沿用 Win 既有路径(`Global.Path.cache/office-installer/`)。下个 feat 如果统一抽 install 引擎,再考虑改名 `pkgPath`。
- DMG 内 .app 名字识别用 `endsWith(".app") + /libre/i`(LibreOffice 各版本目录里 .app 名可能含版本号,用 regex 兼容)。
- 不实现"暂停 / 恢复"下载:fetch 流式写 `.part`,失败 retry 全量重下,简化心智负担。LibreOffice 281MB 在国内镜像下通常 1-2 分钟,不值得做断点续传。
