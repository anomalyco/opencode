# DeskFox installer 版本日志

> 版本号规则:`YYYY.M.D.N`(年.月.日.当天第几版,N 从 1 开始)
> **Windows 和 macOS 各自独立 N 序列**(同一天 Win 打 1 次 + Mac 打 2 次,版本号分别为 [Windows] X.1 + [macOS] X.1, [macOS] X.2,**不共享计数器**)
> 每次跑 `pack-installer.ps1`(Windows)/ `pack-installer.sh`(macOS,待补)自动 bump + 编译,产生一条新 entry。
> 这个文件**只记录 ship 出去的 installer 版本**,不等同于 git commit。
> commit 索引看 [`改动日志.md`](改动日志.md)。

---






## [macOS] 2026.5.5.1 — 2026-05-05 23:43

**主菜:Mac 端 4 天累积更新一次性出 ship** — 自 [macOS] `2026.5.4.1`(2026-05-04 00:05)以来 dev 主干推进 38 笔 commit,涉及 markdown viewer 渲染 / 编辑 / 文件树 / i18n 全面增强,与 Win 端 [`2026.5.5.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.5.1) 同源。

主要内容:

- **md-editing-enhance** ([changelog](features/md-editing-enhance/3-changelog.md)) — MD 编辑体验增强(Tier B 全套 + Ctrl+F 查找 + post-launch 18 轮修复);加 `@codemirror/search` dep,新 `markdown-editor-extensions.ts`(+439 行)
- **md-office-improvements** ([changelog](features/md-office-improvements/3-changelog.md)) — MD 渲染 4 phase 全套上线:Phase 1 本地资源 protocol(.md 内 `<img>/<video>/<audio>` + HTML 预览)/ Phase 2 Frontmatter 隐藏 + Callout + 脚注 / Phase 3 Mermaid 流程图动态加载 / Phase 4 TOC 常驻面板 + MD 内链跳转;含 6 项 P0 渲染修 + 中文路径双重编码 + 脚注 SANITIZE_NAMED_PROPS 锚点 + 切 tab 文件树自动 active 高亮 + Win path 分隔符 + 4 项视觉 polish + 内链下划线密集恐惧修
- **file-tree-ux-polish** ([changelog](features/file-tree-ux-polish/3-changelog.md)) — 文件树 UX 5 项:① LLM 响应结束自动递归刷新 ② 节点右键菜单 4 组重整(删打印 + 加复制路径/刷新)③ 空白菜单 + 修刷新递归 ④ 默认面板展开 + tab "all" ⑤ 键盘 ↑↓/Enter/F2/Delete + macOS Backspace
- **menu-i18n** ([changelog](features/menu-i18n/3-changelog.md)) — 文件树菜单 / 对话框 / toast 接入 i18n 框架(en / zh / zht 三本 dict)
- **filetree-ctrlc-textsel-fix** + **viewer-ctrlc-fix** — 修聊天气泡 / md 查看器 / 非 .md 文档选文本后 Ctrl+C 失效(B 路径加文本选区闸 + shadow DOM 路径修)
- **actions-node24-bump** ([changelog](features/actions-node24-bump/3-changelog.md)) — workflows 升级 Node 20→24,清掉 GitHub 6/2 deadline 前 deprecation 警告
- **branch-pull-rule** — 治理硬规则:开新分支前必先拉最新 dev(CLAUDE.md 分支策略 v2 段)
- 其他治理沉淀(数据目录隔离评估暂搁 / spec 过期 frontmatter 修等)详见 [改动日志.md](../改动日志.md)

**Release**:[GitHub Release `ship-mac-prod-2026.5.5.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-mac-prod-2026.5.5.1)
- 文件:`DeskFox-2026.5.5.1_aarch64.dmg`
- 大小:55.49 MB(58,185,315 bytes)
- 架构:Apple Silicon(arm64,`aarch64-apple-darwin`)
- SHA256:`84957d09bb5bba2f3f558d77e27f21778adf71ca1d42912fedffce601c341f03`
- Bundle ID:`ai.deskfox.app`(prod,跟 sst/opencode 0 命名空间共享)

key commit: `c7e7cbb57`(本笔 bump commit;基于 dev `98cbe12d7`)
build run: [Actions run 25386808671](https://github.com/zoulukuang/deskfox/actions/runs/25386808671)(success)

**Gitee 镜像**:user 在 Win 端处理(2026-05-06 起 Mac 端 ship 不跑 mirror,见 memory)

**上游 baseline**:跟 dev 同步(同 `2026.5.4.1`,sync-2026-05-03-2 后基线)

---
## [Windows] 2026.5.5.1 - 2026-05-05 23:39

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

---

## [macOS] 2026.5.4.1 — 2026-05-04 00:05

**主菜:Mac 端首次走 GitHub Actions 全自动 release**(对应 Win 端 [`ship-prod-2026.5.1.2`](https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.1.2) 已落地的同款链路,延伸到 mac 平台)。

自 [macOS] `2026.4.30.3`(2026-04-30)以来 Mac 端 4 天未 ship,这中间 dev 主干推进显著(跟 Win [`ship-prod-2026.5.3.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.3.1) 同源):

- **release-mac-ci** ([changelog](features/release-mac-ci/3-changelog.md)) — 新增 `release-mac-deskfox.yml` workflow,push `ship-mac-(prod|beta)-*` tag 触发 GitHub Actions `macos-latest` runner build .dmg + 创 draft Release;workflow 内自带 .dmg 重命名(对齐 Win)+ Release body 含 Gatekeeper "右键打开" 提示;**本笔即首次实战验证**(dispatch dev 7m13s + tag prod 4m50s 全绿)
- **sync-2026-05-03-2** ([changelog](features/sync-2026-05-03-2/3-changelog.md)) — 本季首次 sync upstream 成功,upstream 462 commits / 1157 文件 / +58k/-53k 行 全 take(Effect HttpApi infra / shared→core rename / Updater API rename 等)
- **office-routes-effect-httpapi** ([changelog](features/office-routes-effect-httpapi/3-changelog.md)) — fork 的 4 个 office routes(`/file/office-pdf` + `/office-tooling/{status,install,progress}`)迁到 PublicApi,httpapi-mode SDK 含 fork office method
- **updater-disable-adapter-rollback** — Updates 段控件灰显恢复(撤回 sentinel pattern UX bug)
- **repo-migration-deskfox** + **user-rename-zoulukuang** — GitHub 主仓 `yuesoue/opencode-for-office-deskfox` → `zoulukuang/deskfox`(同时 user rename),本笔 release 已挂在新仓
- **gitee-release-mirror** + 其他 sync 链路相关 prep / postmortem,详见 [改动日志.md](../改动日志.md)

**User 实测验证**:本机 `gh run download` 拉 .dmg + SHA256 校验通过(`831580ac... = Release body 期望值`,字节级一致)。dispatch dev 模式 .dmg 已开启 Gatekeeper 流程通过,prod 跟 dev 仅 productName / Bundle ID / icon 三档差异。

**Release**:[GitHub Release `ship-mac-prod-2026.5.4.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-mac-prod-2026.5.4.1)
- 文件:`DeskFox-2026.5.4.1_aarch64.dmg`
- 大小:52.32 MB(54,866,286 bytes)
- 架构:Apple Silicon(arm64,`aarch64-apple-darwin`)
- SHA256:`831580ac51aebd8ded330b32e63482b96aaa10929716f056f9198656723f08b7`
- Bundle ID:`ai.deskfox.app`(prod,跟 sst/opencode 0 命名空间共享)

key commit: `e9048e591`(bump commit;基于 dev `dd137fee5`)
build run: [Actions run 25284065820](https://github.com/zoulukuang/deskfox/actions/runs/25284065820)(4m50s,actions/cache 命中)

**上游 baseline**:跟 dev 同步(sync-2026-05-03-2 后,~1.14.x + 上游推进)

---
## [Windows] 2026.5.3.1 - 2026-05-03 14:04

**主菜:本季首次 sync upstream 成功**(吃了 462 commits / 1157 文件 / +58k/-53k 行 — 2-3 周的所有上游改进)。

主要内容:
- **sync-2026-05-03-2** ([changelog](features/sync-2026-05-03-2/3-changelog.md)) — upstream 462 commit 全 take,8 个 conflict 全 resolve,含 Effect HttpApi infra 大 PR / shared→core rename / Updater API rename(update→updateAndRestart + 加 relaunch)等
- **office-routes-effect-httpapi** ([changelog](features/office-routes-effect-httpapi/3-changelog.md)) — fork 的 4 个 office routes(`/file/office-pdf` + `/office-tooling/{status,install,progress}`)迁到 PublicApi,httpapi-mode SDK 含 fork office method
- **updater-disable-adapter-rollback** ([changelog](features/updater-disable-adapter-rollback/3-changelog.md)) — Updates 段控件灰显恢复(撤回早些时候 sentinel pattern UX bug)
- **win-bun-install-fix** ([changelog](features/win-bun-install-fix/3-changelog.md)) — Windows install 不再被 tree-sitter-powershell native build 阻断(对 dev env 影响,user 不感知)
- **changelog-archive-pre-v2** + **zod-schema-bridge** + **post-sync-build-fix** + **sync-2026-05-03-aborted** + **dev-typecheck-fix** + **updater-disable-adapter** — sync 链路相关 prep / postmortem / 治理沉淀,详见 [改动日志.md](../改动日志.md)

User 实测全过(office viewer / 聊天 / 文件操作 / 设置面板 / 安装入口 5 项)。

key commit: `ac5af022d`(本笔 release 起点 = bump commit 父,bump commit 是 release tag 内容)
installer 路径: 等 GitHub Actions 跑完 `ship-prod-2026.5.3.1` tag 后,从 [GitHub Release](https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.3.1) 下载

---

## [Windows] 2026.5.1.2 - 2026-05-01 22:20

**主菜:Win 首次走 GitHub Actions 全自动 release**(release-自动化 feat 落地首笔实战 ship,延伸到 Mac 端的链路即 [`ship-mac-prod-2026.5.4.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-mac-prod-2026.5.4.1))。

自 `2026.5.1.1`(同日早些时候)以来,新增内容全部为 release-自动化 feat 实施:
- **release-自动化** ([changelog](features/release-自动化/3-changelog.md)) — 5 笔 commit(`10c98374a` / `17b159f25` / `49ba8005c` / `b1092742a` / `59afb8413`):`.github/workflows/release-deskfox.yml` 主体 workflow + pre-commit 黑名单豁免 `*-deskfox.yml` + DeskFox.iss IconFile 按 AppEnv 走 + sidecar copy 前确保目标目录;push `ship-prod-*` tag 触发 GitHub Actions `windows-latest` runner build .exe + 创 draft Release

**Release**:[GitHub Release `ship-prod-2026.5.1.2`](https://github.com/zoulukuang/opencode-for-office-deskfox/releases/tag/ship-prod-2026.5.1.2)(**老仓** `zoulukuang/opencode-for-office-deskfox`,2026-05-03 仓库迁移到 `zoulukuang/deskfox` 时 release 没自动跟过来 — GitHub 设计如此)
- 文件:`DeskFox-2026.5.1.2-setup.exe`
- 大小:46.63 MB(48,897,142 bytes)
- 架构:x86_64 Windows(Inno Setup 打包,未签名)
- SHA256:`9751BECBC56FD280F97A4CBA5C6189F6B3C2D6374D23B70FE479D3CAB1A49FE3`
- AppId:prod GUID(锁死,详见 win-tri-env-appid feature)

key commit: `59afb8413`(bump commit;基于 `2026.5.1.1` 基础)
publish 时间:2026-05-01 22:50(UTC+8)

**上游 baseline**:1.14.21(沿用)

---

## [Windows] 2026.5.1.1 - 2026-05-01 14:21

**性质:Win prod 首笔自用 build**(本地 `pack-installer.ps1` 走 bump → build,**未挂 GitHub Release**;后续被同日 [`2026.5.1.2`](#windows-202651-2--2026-05-01-2220)(GitHub Actions 自动)取代,本笔保留作 build 链路验证记录)。

自 [Windows] `2026.4.29.2`(2026-04-29)以来 Win 端 2 天未 ship,这中间 dev 主干推进显著:
- **win-tri-env-appid** (`21c3f80f9`) — Win 三档 AppId 同机共存,`DeskFox.iss` 加 `#if AppEnv` 切 GUID(prod 锁死 / beta `{86413DCA-EA81-415A-A309-473EBFD78990}` / dev `{4C5D29F2-3BBB-49A2-B248-B74B716F8EA1}` 新生成),`pack-installer.ps1` 加 `-Env` 参数,Mac/Win 三档共存能力对齐
- **同期 macOS 工作**(对 win build 透明,但占同期 dev 主干):`macos-pack-installer` / `office-installer-macos` / `prod-bundle-id-fix` / `bundle-id-debrand` 等 — ship 在 `[macOS] 2026.4.30.2/.3` 两笔 mac entry 里
- **分支策略-v2** v1.0/v1.1 — dev 单一稳定主干 + 上游同步分离(`sync/upstream-<日期>` 临时分支)+ 远端主仓策略调整(GitHub 升 origin / Gitee 降镜像)
- **双端协作-SOP** v1.2 — feat 一次性容器 + Win/Mac 双端协作流程(rebase/merge/删分支)+ dev 上小补丁直推规则

**installer**:`packages/branding/installer/Output/DeskFox-2026.5.1.1-setup.exe`(**本地路径**,未上传 GitHub Release)

key commit: `60e617451`(bump commit;`pack-installer.ps1` 跑 bump → build → record bump 三联自动产物)

**上游 baseline**:1.14.21(沿用)

---

## [macOS] 2026.4.30.3 — 2026-04-30 16:30

**包含**(自 `2026.4.30.2` 之后唯一增量):
- `bundle-id-debrand`(`3fd5ceaf5`):Bundle ID 完整品牌切割,三档全去 `opencode` 字眼,改 `ai.deskfox.app` 系列(prod / `.beta` / `.dev`),reverse-DNS 与域名 `deskfox.ai`(在 user 手中)对齐;与 sst/opencode 上游 0 命名空间共享,未来 TCC / URL Scheme / Universal Link / OAuth callback 都不会冲突

**配套要求**:**首装零额外步骤** ✅ — 实测 macOS 14+ 对用户目录(~/Downloads / ~/Documents 等)TCC 自动放行,**无任何弹窗,直接可用**(此实测推翻了 `2026.4.30.2` entry 中"长期治理:加 Info.plist usage description"的提议 — 不需要做,问题不存在)。

**installer**:`packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox-2026.4.30.3_aarch64.dmg`(49,263,356 bytes)

**user 验收**:
- ✅ 装到 `/Applications/DeskFox.app`,Bundle ID 验证 `ai.deskfox.app`(完全无 opencode 字眼)
- ✅ 启动后访问 ~/Downloads → 无弹窗 → 直接列出文件 / 加载会话(macOS 14+ 自动 TCC 放行)
- ⚠️ **已知遗留**:应用程序网格里能看到 DeskFox 图标,但顶上**搜索框搜 "desk" / "fox" 搜不到**(Cmd+Space Spotlight 搜得到,Raycast 等第三方启动器也搜得到,只有 macOS 自带应用程序网格搜索没收录)。猜测原因:`ai.deskfox.app` 是全新 reverse-DNS 命名空间,系统索引刚 register 还没扫到 / 或对未见过的 reverse-DNS 有冷启动延迟。**不影响日常使用**,user 通过 Cmd+Space / Launchpad 图标点击 / Dock 等其它途径都能启动。下次治理(可能 `lsregister -kill -r` 全量重扫 / 等 Spotlight 完整扫描周期 / 重启 Mac)

**上游 baseline**:1.14.21(沿用)

---
## [macOS] 2026.4.30.2 — 2026-04-30 15:16

**包含**(自 Win `2026.4.29.2` 后的 macOS 全部增量,首版 macOS prod):
- `加聊天-option-enter`(`00b208eed`):文件查看器右键加聊天对话框 macOS 加 Option+Enter 提交快捷键 + 底部文案平台化(Tiny)
- `macos-pack-installer`(`373195692` + `833335031` follow-up):macOS 一键打 `.app/.dmg` 脚本 + apply-icons.sh 现场生成的 `icon.icns` 入 `.gitignore` + 4 sh +x 权限 + pack-installer.sh build 后自动 mv `.dmg` 加 installer 版本号(对齐 Win `DeskFox-YYYY.M.D.N-setup.exe` 命名)
- `office-installer-macos`(`fc69b462c`):LibreOffice 自动安装 macOS 适配 — DMG 下载 + hdiutil 挂载 + cp -R 到 `~/Applications` + soffice 检测路径(R4 override 第 4 笔本季,延续 `66c8fa523` 初版,wrapper 不可行论证见 changelog)
- `prod-bundle-id-fix`(`7618346fe`):prod / beta 各加独立 Bundle ID override,prod 用 `ai.opencode.desktop`(无 `.dev`)修 macOS 26 应用程序网格搜不到的问题;三档 Bundle ID 独立可共存

**配套要求**:首装 user 必须加 **"完全磁盘访问权限"**(系统设置 → 隐私与安全性)。原因:Bundle ID 改了 = macOS TCC 视为新应用,所有"文件夹访问"权限重置;Info.plist 又缺 `NSDownloadsFolderUsageDescription` 等声明,首次访问 `~/Downloads` 时不弹授权对话框,直接静默拒绝(EPERM)。**长期治理**:下笔加 Info.plist usage description 让对话框正常弹,届时装机零额外步骤。

**installer**:`packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox-2026.4.30.2_aarch64.dmg`(49,263,424 bytes)

**user 验收**:✅ 装到 `/Applications/DeskFox.app`(Bundle ID 验证 `ai.opencode.desktop` 干净)+ 加完全磁盘访问权限后,项目重新加载,文件 / 会话正常;应用程序网格搜 "desk" 可见 DeskFox

**上游 baseline**:1.14.21(沿用,`package.json` 不动避开上游冲突;dmg 文件名走 fork 自己的 installer 版本号 `2026.4.30.2`,.app 内部 `CFBundleShortVersionString` 仍是 1.14.21)

---

## [macOS] 2026.4.30.1 — 2026-04-30 13:01(已废弃,未 ship)

**废弃原因**:Bundle ID 沿用 base `tauri.conf.json` 的 `ai.opencode.desktop.dev`(prod.json 当时未 override identifier),macOS 26 应用程序网格搜索把 `.dev` 后缀 Bundle ID 当开发版隐藏 — 网格里图标可见但搜索栏过滤掉,不可接受。当天 push `7618346fe` 修复后重打 `2026.4.30.2`,本版 dmg 已被 `2026.4.30.2` 覆盖 / 不分发。

详见 `docs/features/prod-bundle-id-fix/3-changelog.md`。

---
## [Windows] 2026.4.29.2 — 2026-04-29 21:56

**包含**:
- md-viewer-typography:文件查看器看 .md 时排版升级 — 标题加粗阶梯 + 行内代码芯片 + 引用块/表头底色 + HR 显形(commit `f66b26be0`,Tiny,走 wrapper 0 上游侵入,0 override 消耗)
- 上一版 (.1) 包含的全部内容沿用(claude-code-loop-fix / plugin-cwd-channel / build-pipeline-sidecar-fix / icon-pipeline / installer-versioning)

**配套要求**:无 plugin 仓改动,纯前端 CSS scope 增量

**installer**:`packages/branding/installer/Output/DeskFox-2026.4.29.2-setup.exe`(49,095,582 bytes)

**user 验收**:✅ 装好正常启动,文件查看器 .md 排版生效(标题阶梯清晰),聊天侧排版无变化

**上游 baseline**:1.14.21(沿用)

---

## [Windows] 2026.4.29.1 — 2026-04-29 14:49

**包含**:
- claude-code plugin step loop 卡死修复(case-1,commit `e2a9d7167` R4)
- spawn-based plugin cwd channel(`_opencode.cwd` 协议增量,commit `41817499d` R4 第 3 笔特批)
- build pipeline sidecar 自动 build(commit `b9581b76e`)
- icon-pipeline-deep-fix follow-up:png-to-ico ≥256 修复(commit `303fbc583`)
- apply-icons.ps1 ASCII 化(已并入 `e2a9d7167`)
- installer 版本号规则规范化(本笔)

**配套要求**:
- plugin 仓 `D:\project\deskfox-plugins\claude-code\` commit `faf552c`(读 `_opencode.cwd`)+ dist build 完
- user 装新 installer 后,选项目 X → 发"在哪个项目里" → Claude 看到 X 路径 ✅

**installer**:`packages/branding/installer/Output/DeskFox-2026.4.29.1-setup.exe`(49,101,493 bytes)

**上游 baseline**:1.14.21(本仓 fork 起点;upstream/dev 现 1.14.28,可下季度 rebase)

---

## 历史(2026-04-28 ~ 2026-04-29 早些时候,旧 1.14.21 命名规则,Windows-only)

旧规则下 installer 都叫 `DeskFox-1.14.21-setup.exe`,接收方区分不开。从 2026.4.29.1 起统一新规则。

| 时间 | 旧文件名 | 含义 |
|---|---|---|
| 2026-04-28 21:17 | DeskFox-1.14.21-setup.exe(已弃)| installer-打包 + icon-pipeline-deep-fix 第 1 版 |
| 2026-04-29 11:48 | DeskFox-1.14.21-setup.exe(已被覆盖)| 含 case-1 fix(claude-code-loop-fix)|
| 2026-04-29 14:29 | DeskFox-1.14.21-setup.exe(已删,内容等于 .1)| 含 case-1 + cwd channel(完整),命名规则切换前最后一个 |
