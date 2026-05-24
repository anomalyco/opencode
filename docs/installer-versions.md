# DeskFox installer 版本日志

> 版本号规则:`YYYY.M.D.N`(年.月.日.当天第几版,N 从 1 开始)
> **Windows 和 macOS 各自独立 N 序列**(同一天 Win 打 1 次 + Mac 打 2 次,版本号分别为 [Windows] X.1 + [macOS] X.1, [macOS] X.2,**不共享计数器**)
> 每次跑 `pack-installer.ps1`(Windows)/ `pack-installer.sh`(macOS,待补)自动 bump + 编译,产生一条新 entry。
> 这个文件**只记录 ship 出去的 installer 版本**,不等同于 git commit。
> commit 索引看 [`改动日志.md`](改动日志.md)。

---










## [macOS] 2026.5.24.1-dev — 2026-05-24

**包含**:feishu-bridge-light 三件套全套(`/new` 私聊清话题 / `[ATTACH:path]` 文件回传 / `[CREATE_GROUP:name]` opt-in 自动建群) + e2e-pre-push-gate + e2e-vite-warmup 等 main 上 commits。

- main HEAD ship 节点:`3842689c2`(Merge 'main' of github)
- feishu-bridge-light merge commit:`433a7557b`
- 测试基线:adapter-feishu-lark 391 pass / 0 fail / 803 expect
- 范围:仅本机自测,**未公开 ship**(不发 GitHub / Gitee Release)
- 用途:user 真机飞书 IM 实测 Phase 2/3 marker 协议(`[ATTACH:]` / `[CREATE_GROUP:]`),回归 OK 后再补完整 Tier 2 公开发布

---
## [macOS] 2026.5.21.1-dev — 2026-05-21 22:43

**主题**:Mac 端首次 Tier 2 预览版(`-dev` 后缀)— 自 [macOS] `2026.5.12.1`(2026-05-12 prod)以来主线 21 笔 commit 全部治理 / 工具改进,**无新增用户可见功能**。本笔 ship 重点是验证 Tier 2 流程闭环 + 把两笔 ship 翻车 fix 合入产品。

包内容:

- **sdk-falsy-empty-body-fix** ([changelog](features/sdk-falsy-empty-body-fix/3-changelog.md))— 补 2026-05-12 sdk-falsy-error-fallback-fix(surface fix)没盖的路径 ②(fetch.return-with-empty-body-4xx),wrapFetchWithFalsyGuard layer 2 不让 SDK 抛 `{}`。**5.21.1-dev ship 第一次撞**:user 装上启动报"Unknown error / 原因: {}",诊断后写此 fix。
- **frontend-stale-session-fallback** ([changelog](features/frontend-stale-session-fallback/3-changelog.md))— 接力上一笔到产品级闭环:`directory-layout.tsx` 启动 createResource 识别 stale session error 后 navigate 去掉 stale id 降级到主界面,不撞 ErrorBoundary。**5.21.1-dev ship 第二次撞**:fix 上一笔后错误信息从 `{}` 变成 `Server returned 401 with empty body: ...` 但 ErrorBoundary 仍出,写此 fix。
- **abandon-cloud-build-workflows** ([changelog](features/abandon-cloud-build-workflows/3-changelog.md))— 治理决策:云端 build workflow 永久废止,所有 ship 走本地。
- **ship-scripts-naming-fix** ([changelog](features/ship-scripts-naming-fix/3-changelog.md))— ship 脚本 4 个对齐新命名规则(strip env suffix + productName 空格转横杠),Tier 2 tag 识别。本笔实战首验。
- **installer-naming-cleanup** + **3tier-versioning-governance** + **rename-dev-to-main** + **installer-version-env-suffix** — 4-tier 体系治理(主分支 dev→main / installer 文件名去重 / 版本号 B2 双维独立 N / pack/bump 透传 env)2026-05-21 同期落地。
- **large-file-preview-guard** + **chat-drop-overlay-stuck-fix** + **chat-input-focus-follow** + **chat-selection-menu** + **file-tree-multi-drag-to-chat** + **file-tree-llm-write-refresh** + **html-viewer-ux-polish** + **html-viewer-allow-scripts** — 文件预览 + 聊天 UX 改进合集。

**Build**:

```
bash packages/branding/scripts/pack-installer.sh --env dev
# (5.21.1-dev 首 build → frontend bug,后续含 fix 重 build 走 --no-bump 保版本号)
```

**Release**:[GitHub Release `ship-mac-dev-2026.5.21.1-dev`](https://github.com/zoulukuang/deskfox/releases/tag/ship-mac-dev-2026.5.21.1-dev)
- 文件:`DeskFox-Dev-2026.5.21.1_aarch64.dmg`
- 大小:64.5 MB
- 架构:Apple Silicon(arm64,`aarch64-apple-darwin`)
- Bundle ID:`ai.deskfox.app.dev`(Tier 2 独立 AppId,跟 prod 同机共存)
- Prerelease 标:✅(对外预览版)

**双平台分发**(Mac ship 跟 prod 一致规则):
- GitHub Release `ship-mac-dev-2026.5.21.1-dev`(主仓 `zoulukuang/deskfox`)
- Gitee Release(镜像 `zoulukuang/deskfox`)

**验证**:e2e — restore stale state(`~/Library/Application Support/ai.deskfox.app.dev/`)后启动新 .app,frontend 通过 stale-session-fallback 自动 navigate 去掉 stale id,直接进 deskfox-plugins 工作区主界面。

---
## [Windows] 2026.5.21.1-dev - 2026-05-21 20:40

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

---

## [Windows] 2026.5.15.1 - 2026-05-15 09:39

**主题**:文件查看器 + 聊天对话区 UX 一致性大补 — HTML 预览 iframe 翻页 / UX 优化 + 文件树自动刷新 + 多选拖到聊天 + 聊天选区右键菜单。

5 笔 feat 合 dev 一次性 ship(12 commits 跨 4 笔 feat 分支,每笔代码 + docs + merge):

- **[html-viewer-allow-scripts](features/html-viewer-allow-scripts/3-changelog.md)**(`9acf2e5c3`)— iframe sandbox 加 `allow-scripts`,解决 PPT/Slides 翻页按钮等内嵌 JS 失效(讲师版 PPT 21 页 `◀ 1/21 ▶` 点击无反应)。跨 origin 论证(Win `tauri.localhost` vs `localasset.localhost` 不同 host、Mac `tauri://` vs `localasset://` 不同 scheme)→ MDN "scripts+same-origin combo" 警告不适用,iframe 内 JS 无法 reach parent。反转 `md-office-improvements` spec A1.9 "script 失活"决策

- **[html-viewer-ux-polish](features/html-viewer-ux-polish/3-changelog.md)**(`2ae3e14eb`)— Medium 4 块改动:① 去顶部 `预览/源码` toolbar + iframe 占满 + 编辑入口走右键 → CodeMirror html 语法模式(`@codemirror/lang-html@6.4.11` 新 dep,R4 第 6 笔本季已超配 user 授权) ② iframe 跨 origin 右键弹自家菜单 — `local_asset.rs` 给 HTML 响应注 capture-phase contextmenu listener(preventDefault native + postMessage x/y/选区文本 → 父),父侧 message handler 翻译坐标弹 mdMenu ③ 同注入脚本扩展 mousedown 通道修"右键弹菜单后左键点 iframe 内菜单不消失"bug ④ 阈值 2MB→10MB 对齐 `MAX_EDITABLE_BYTES`,>10MB 走 placeholder。5 个 Rust 单测覆盖 HTML 注入行为

- **[file-tree-llm-write-refresh](features/file-tree-llm-write-refresh/3-changelog.md)**(`5aa50eeec`)— AI 创建新文件后右侧文件树自动浮现。根因:`watcher.ts` `file.edited` 主路径对"路径不在 cache/open"直接 return,不刷父目录;busy→idle 兜底只走 expanded 目录,跳过 `loaded:true + expanded:false` 缓存目录 → user 重新展开看到旧 children,唯一破解 F5。修法:`!hasFile && !isOpen` 时若 `isDirLoaded(parent)` 则 `refreshDir(parent)`。R5 复现测试先写 + `[bug-repro: ...]` tag。watcher.test.ts 10→12

- **[file-tree-multi-drag-to-chat](features/file-tree-multi-drag-to-chat/3-changelog.md)**(`e2f7fef6c`)— 文件树多选(Shift/Ctrl 选 N 项)拖到聊天窗口接通。`file-tree-dnd` feat 留的 `application/x-deskfox-paths` MIME(JSON[abs paths])原本只设计树内移动,聊天侧 `attachments.ts` 只读单选 `text/plain: file:<rel>` → 多选拖等于啥都没拖。修法:新 `multi-path-drop.ts` 纯 helper(7 种边界容错)+ `handleGlobalDrop` 加多选 MIME 分支 N 个路径循环 addPart。helper extract 模式 + 10 单测

- **[chat-selection-menu](features/chat-selection-menu/3-changelog.md)**(`b71a4ad2e`)— 聊天对话区右键选区菜单替换 WebView2 原生菜单。DeskFox 自家两项(添加到聊天 / 复制)+ 输入面板模式跟文件查看器一致(textarea + Ctrl/Cmd/Opt+Enter)+ 红色 overlay(textarea 焦点丢原生选区 → 自家 fixed div 兜底)。新 `chat-selection-quote.ts` 纯 helper(composeQuotedMarkdown + insertTextIntoPrompt,12 单测)+ 新 `chat-selection-menu.tsx` 独立组件(capture-phase document contextmenu + scope `[data-slot="session-turn-list"]` + Portal 弹菜单)

**实测验证**(本机 2026-05-14/15):
- typecheck 16/16 ✅
- bun test:watcher 12/12 + attachments 17/17 + chat-selection-quote 12/12 + html-viewer Rust 单测编译干净 ✅
- pack-installer.ps1 -Env prod 1m32s + iscc 72s → 59.2 MB installer
- 安装到 `D:\softwares\DeskFox\`(user 自选路径)→ 启动 → 飞书绑定 OAuth ✅(首次撞 opencode jsonc plugin entry 残留,memory `reference_opencode_config_path_win.md` 沉淀)
- 五项 feat runtime 实测全过(PPT 翻页 + 文件树自动刷 + 多选拖 + 聊天选区菜单)

**installer**:`packages/branding/installer/Output/DeskFox-2026.5.15.1-setup.exe`(62,032,805 bytes)

**📦 安装步骤(给 user 看的)**:
1. 下载 `DeskFox-2026.5.15.1-setup.exe`
2. 双击运行(InnoSetup 向导),默认装 `C:\Program Files\DeskFox\` 或可自选路径
3. 装完会自动覆盖现有 prod 5.12.1(同 AppId `{F9F6F6C5-...}` → InnoSetup 升级模式,保留用户配置)
4. 首次启动 setup hook 自动 inject 飞书桥接 plugin 到 `~/.config\opencode\opencode.jsonc`(若 inject 缺失,手动 `plugin: ["file:///<install_dir>/plugin/feishu-bridge"]`)

**双平台分发**:
- GitHub Release `ship-prod-2026.5.15.1`(主仓 `zoulukuang/deskfox`)
- Gitee Release(镜像 `zoulukuang/deskfox`,Claude 自动跑 mirror-asset-to-gitee.ps1)

**已知**:setup hook `inject_plugin` 在某些场景(2026-05-15 user 实测)未自动写入 plugin URL(`inject_imbot_agent` 同步骤成功但 plugin 字段未注),手动 inject 即修。真 bug 留 backlog 后续 feat 调研

---

## [macOS] 2026.5.12.1 - 2026-05-12 12:22

**主题**:跟 Win 5.12.1 同步 — imbot v3 极简档(13 ask:9 unix + 4 win)+ dedup-cache-persist + feishu-plugin-dedup-decision + build-script-json-fallback + bug-repro grep 兜底 fix,Mac 端本地 build 出 prod .dmg。

跟 Win 5.12.1 内容完全一致(全部 feat 都在 dev 上,5.11.4 之后第一次 Mac ship),包内容:

- **imbot-permission-minimal**(v3 极简档,跟 Win 5.12.1 相同)
- **imbot-windows-delete-cmds**(v3.1 micro-patch,Mac 端 dead weight 但保留对齐 — bash 13 条 ask 含 4 条 Win 风格 pattern;Mac LLM 不会用 PowerShell 命令,0 行为影响)
- **dedup-cache-persist**(DedupCache 加 persistPath,Mac 端实测 sidecar 重启后 reload + skip 老 message_id)
- **feishu-plugin-dedup-decision**(开发机三档累积根因诊断 + 决策不做产品层防御 + build-deskfox.{sh,ps1} post-build 清理 hook)
- **build-script-json-fallback**(双 jsonc/.json fallback)+ **follow-up `33c7dd948`** Mac 端 bug-repro fix(`grep -c` 0 match 时 `|| echo 0` 多输出 `0\n0` 撞 bash arithmetic syntax error)
- **sdk-falsy-error-fallback-fix**(5.11.x 翻车真因 fix,在 dev 已合)

Mac 端实测验证(本机 2026-05-12 11:55 + 11:59 + 12:22 三次 build/launch):
- typecheck 16/16 ✅
- cargo test feishu_plugin_install 19/19 ✅
- bash -n build-deskfox.sh ✅,**stderr 干净**(grep fix 生效)
- prod build 1:22(总时间)/ cargo 35s
- setup hook 自动 inject prod 路径 + imbot v3.1 skip + 1 plugin instance + dedup persist load 6 entries + wss connected ✅
- **观察**:fresh prod 首次启动 sidecar idle 2 分钟+,user 反馈"晚了一会儿才点系统授权对话框",高度可能 TCC 阻塞 → backlog `prod-首次启动-sidecar-idle.md`

**installer**:`packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox-2026.5.12.1_aarch64.dmg`(64,645,764 bytes)

**📦 安装步骤(给 user 看的)**:
1. 下载 `DeskFox-2026.5.12.1_aarch64.dmg`(Apple Silicon arm64)
2. 双击 .dmg 挂载 → 拖 DeskFox 到 Applications
3. ⚠️ **不要双击 .app 启动!** .app 没数字签名,新版 macOS 直接提示 "DeskFox 已损坏,无法打开。您应该将它移到废纸篓"。先打开「终端」执行(只需一次):
   ```bash
   xattr -cr /Applications/DeskFox.app
   ```
   清掉系统的 quarantine(隔离)标记。
4. 然后双击 Applications 里的 DeskFox 启动
5. 首次启动会弹系统授权对话框 — 请点「同意」给本地文件访问授权,否则 DeskFox 内的飞书桥接 sidecar 不会立即启动(可能要 1-2 分钟才恢复 — 即`prod-首次启动-sidecar-idle.md` 需求池记的 TCC 阻塞)

**已知**:
- pack-installer.sh `--no-bump` 时跳过 rename(NEW_VERSION 为空)— 本次手动 rename,加进需求池后续修
- 首次启动 sidecar idle 2 分钟+ 是 TCC 授权对话框阻塞,user 必须点同意

**双平台分发**(2026-05-12 起新规则反转 — Mac 端 ship 也推 Gitee,之前 memory 立的"Mac 不跑 Gitee"分工撤回):
- GitHub Release `ship-mac-prod-2026.5.12.1`(主仓 `zoulukuang/deskfox`)
- Gitee Release(镜像 `zoulukuang/deskfox`)

---

## [Windows] 2026.5.12.1 - 2026-05-12 11:38

**主题**:imbot v3 极简档 + Windows PowerShell 删除命令补丁(v3.1)+ dedup-cache-persist + 多 feat 打包发车

继 5.11.4 之后第一次干净 build。这一版打包内容:

- **imbot-permission-minimal** ([changelog](features/imbot-permission-minimal/3-changelog.md))— v2 务实档(~30 条 ask)→ v3 极简档(8 条 ask):read 只拦 `.env` + `.ssh`,bash 只拦 8 条真不可逆破坏(`rm -rf` / `git push --force` / `aws s3 rb` / `aws ec2 terminate` / `dd` / `mkfs` / `fdisk` / `shutdown`),webfetch 撤回 allow。user 安全偏好"把隐私保护住,不能随意删除电脑信息就是相对可控的" — 信任飞书 IM 消息流可见(看得到 LLM 在做什么),把可逆操作信任度调高,正常 ship/dev/装包接近 0 打扰

- **imbot-windows-delete-cmds** ([changelog](features/imbot-windows-delete-cmds/3-changelog.md))— v3.1 micro-patch:实测发现 LLM 在 Win 默认 PowerShell shell 跑 `rm -rf` 时,opencode session sqlite 拿到铁证 `{"tool":"bash","input":{"command":"Remove-Item -LiteralPath ..."}}` — LLM 用 PowerShell 原生 `Remove-Item` 而非 unix `rm`,绕过 `bash["rm -rf *"]: ask`,**目录被真删**。补 4 条 Win 风格 pattern(`Remove-Item *` / `rmdir *` / `del *` / `rd *`)覆盖跨 shell 调用。bash 规则数 8 → 13

- **dedup-cache-persist** ([changelog](features/dedup-cache-persist/3-changelog.md))— Mac 端推的 DedupCache 持久化(JSON 落盘 + 原子 rename + corrupt 不 crash),Win 端 smoke test + 真飞书实测 dedup skip 日志铁证全过。sidecar 重启后 load 老 message_id 防 WSS 重连服务器重推老 message 时失忆

- **feishu-plugin-dedup-decision** ([changelog](features/feishu-plugin-dedup-decision/3-changelog.md))— "opencode.jsonc 累积多 feishu-bridge plugin entry → multi-instance → 双推" 根因诊断 + 不做产品层防御决策显式写下;`build-deskfox.{ps1,sh}` 加 post-build 清开发机 jsonc 多余 entry hook

- **build-script-json-fallback** ([changelog](features/build-script-json-fallback/3-changelog.md))— 修 build-deskfox 脚本 jsonc 清理只查 `.jsonc` 漏掉 `.json` 用户的开发者便利 bug。**只影响开发机**,普通用户 0 感知

- **sdk-falsy-error-fallback-fix** ([changelog](features/sdk-falsy-error-fallback-fix/3-changelog.md))— 5.11.x 翻车真因 fix。SDK `client.gen.ts` 的 `finalError || ({} as unknown)` falsy fallback 抛空 `{}` → SolidJS castError → "出了点问题 原因: {}" 错误页。在 `createSdkForServer` fetch 边界兜底转有效 Error,SDK 看到的 error 永远 truthy → fallback 不触发

实测验证(user Win 端 2026-05-12 上午):
- typecheck 16/16 ✅
- adapter bun test 286/289 ✅(3 fail 是 `defaultFilePath` / TTL / hasAndMark LRU touch,**pre-existing flake** 跟 imbot 无关)
- cargo test ⚠️ STATUS_ENTRYPOINT_NOT_FOUND env 老问题持续(dev 基线就有,跟改动无关,留 backlog)
- 飞书实测 imbot v3.1 + dedup-cache-persist 在 Win 真生效(sidecar log 铁证 `[wss] dedup skip om_xxx` + `[permission-card] sent card (bash) → Hebing—one + xiaobei_win`,user 主动点 once 删除测试目录)
- prod installer 装机预检全过(WSS 2/2 connected,1 plugin entry 不会双推,imbot v3.1 配置加载)

ship 流程: bump 2026.5.11.4 → 2026.5.12.1 → tauri build prod → ISCC pack 62MB(2026-05-12 11:38)→ 静默装 prod + 飞书实测 3 条全过

installer:`D:\project\opencode-fork\packages\branding\installer\Output\DeskFox-2026.5.12.1-setup.exe`

---

## [Windows] 2026.5.11.4 - 2026-05-11 23:02

**主题**:5.11.x 系列 ship 修复(vite chunking 非确定性 workaround) + imbot 安全 agent 终于推给 Win 用户

5.11.1 / 5.11.2 / 5.11.3 三次 ship 全撞 **vite chunking 非确定性 bug** — 同源码不同时刻 build 出来的 prod bundle,有时 OK 有时启动期 `castError` 撞死(SolidJS createResource → session.sync → SDK falsy-error fallback 抛 `{}` → SolidJS castError → 错误页)。详见 [`win-ship-prod-5.11.4` 3-changelog](features/win-ship-prod-5.11.4/3-changelog.md) bug 调查段。

- **win-ship-prod-5.11.4** ([changelog](features/win-ship-prod-5.11.4/3-changelog.md))— workaround:用当前 known-working `target/release/DeskFox.exe`(`b268ce694` dev tip 这次 build 实测多轮 UI 正常)**直接 ISCC 重打 installer,不重新 vite build**,避免再撞非确定性。**接受 mismatch**:installer 文件名 + Windows 控制面板显示 `5.11.4` / DeskFox UI 左下角版本牌显示 `v2026.5.11.2`(bundle 没动)
- 失败 ship 记录(均撤回 GitHub + Gitee):
  - `[Windows] 2026.5.11.1` — 用户实测装完立刻崩(撞 castError)
  - `[Windows] 2026.5.11.2` ([changelog](features/win-ship-imbot-5.11.2/3-changelog.md))— 同上,**已从 GitHub draft 删除 + 从 Gitee release 删除**(2026-05-11 16:50 清理)
  - `[Windows] 2026.5.11.3` — 本地 build 5.11.3 第二次重试,仍崩,未推外网

installer 路径:`packages/branding/installer/Output/DeskFox-2026.5.11.4-setup.exe`(59.2 MB,本地 ISCC pack,**target/release 沿用 22:53:13 dev tip 那次 build 的 binary**)

**用户视觉警告**:装出来 UI 显示 `v2026.5.11.2` 是预期,**不是 bug**。Windows "已安装应用"显示 `5.11.4` 才是 ship 标识。两个版本号都对应同一个 ship。

**根因还没真修**,留 backlog(vite manualChunks 显式分块 / SDK falsy-error fallback 改 Error 而非 `{}` / 下次 ship 时干净 rebuild 消除 mismatch),详见 5.11.4 changelog 后续 backlog 段。

---

## [Windows] 2026.5.11.2 - 2026-05-11 15:22 — **撤回**

> ⚠️ **此版本已撤回,GitHub + Gitee 两端 release 已删除**。安装会撞 vite chunking bug 启动期崩。新装请用 [`5.11.4`](#windows-202651114---2026-05-11-2302)。本 entry 保留作历史记录。

**主题**:Win 端补 ship 把 `feishu-bridge-imbot-agent` 安全 agent 推给 Win 用户(对齐 Mac 5.11.1)

[`2026.5.11.1`](#windows-2026511---2026-05-11-815) ship 时序撞 imbot merge 之前(10:24 ship → 13:14 imbot merge → 13:53 Mac ship),导致 Win 5.11.1 不含 imbot,同号 Mac 5.11.1 含。Win 用户飞书桥接 unattended 默认全权限,**安全 regression(相对 Mac)**,本笔补齐:

- **win-ship-imbot-5.11.2** ([changelog](features/win-ship-imbot-5.11.2/3-changelog.md))— Win 跨平台代码 0 改动需求(`feishu_plugin_install.rs` / `config-schema.ts` / `account-store.ts` 全部跨平台原生设计,含 Win UNC 路径处理 + Win Crypto 敏感目录),只走 ship 层补齐。前置审计(`chore/win-port-audit-mac-pack-installer` 分支已销毁)+ 三层 e2e 验证(独立 Rust binary 5 场景 / TS 16 unit / dev installer 实地装 + jsonc 注入确认)全过
- 走 [win-ship-local-pack-switch](features/win-ship-local-pack-switch/3-changelog.md) 第二次实战:本地 `pack-installer.ps1 -Env prod` build + 手动 `gh release create --draft` 带 `.exe` 附件 + curl Gitee API 创 release + `mirror-asset-to-gitee.ps1` 传附件

installer 路径:`packages/branding/installer/Output/DeskFox-2026.5.11.2-setup.exe`(59.4 MB,本地 build)

---


---

## [macOS] 2026.5.11.1 — 2026-05-11 13:49

**主题**:Mac 端跟随 Win [`2026.5.11.1`](#windows-2026511---2026-05-11-815) 同期更新,**新增 `imbot` 安全 agent 收紧飞书桥接 unattended 危险工具默认权限**

自 [`[macOS] 2026.5.7.1`](#macos-202657---2026-05-07-1418)(2026-05-07)以来 dev 主干推进约 50 commits,Mac 端首次 ship。除 Win 端 5.11.1 主题(权限卡片 + 4 笔机制 fix + pack-installer 修)外,Mac 端独立 ship 加 `feishu-bridge-imbot-agent` feat,主要包括:

- **feishu-bridge-imbot-agent** ([changelog](features/feishu-bridge-imbot-agent/3-changelog.md),merge `4a8970f50`)— 飞书桥接默认 agent `build` → `imbot`(setup hook 自动注入到 user opencode.jsonc,idempotent)。同 build 能力同 system prompt,但收紧 `bash` / `edit` / `write` / `apply_patch` / `webfetch` + 敏感目录 read(SSH / AWS / Kube / GPG / Keychain / Crypto)默认 ask。**安全闭环**:LLM 经 webfetch 拉 prompt injection 网页被诱导用 bash 数据 exfil 时,user 在飞书看到权限卡可即时拒绝。**主 GUI 0 影响**(仍走 build agent)
- **feishu-bridge-newuser-onboarding** ([changelog](features/feishu-bridge-newuser-onboarding/3-changelog.md))— 全新用户拿 .dmg 装完即用 happy path 加固:A1 plugin 路径失效自愈 / A4 default model 缺失检测 + 友好降级 / A3 .dmg 拖拽引导背景图(Swift CoreGraphics 660×400 PNG)
- **feishu-bridge-permission-card** + **feishu-bridge-empty-reply-ghost** + **feishu-server-loopback-bind** + **network-bind-safety-guard** + **feishu-plugin-install-win-path** 等 Win 同源 feat(同步进 Mac 端)
- 实测验证:**不通过飞书 IM 界面也能 e2e 测**(plugin server `/debug/simulate-message` curl + log 实证 imbot 真触发 + plugin permission card 完整渲染),memory `reference_imbot_agent.md` 已沉淀技巧

installer 路径:`packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox_1.14.33_aarch64.dmg`(arch=aarch64 / Apple Silicon)

**首次打开**:不签名 .dmg → 拖 .app 到 Applications → 右键 .app → 打开 → "仍要打开"(.dmg 内置 A3 背景图已引导)

---
## [Windows] 2026.5.11.1 - 2026-05-11 08:15

**主题**:飞书桥接 v1 深度迭代(权限卡片真互动 + 4 笔机制 fix)+ Win 网络监听安全规则 + pack-installer 顺序错位修

自 [`2026.5.10.1`](#windows-2026511---2026-05-10-1154) 以来 dev 主干推进约 30 commits,主要 feature:

- **feishu-bridge-permission-card** ([changelog](features/feishu-bridge-permission-card/3-changelog.md),merge `8d86d440d`)— opencode `permission.asked` Bus event 拦截 → 飞书 CardKit 渲染交互卡片(允许一次 / 始终允许 / 拒绝)→ user 飞书侧点击 → plugin 走 v1 SDK `postSessionIdPermissionsPermissionId` 回写 opencode 解锁。**保持 user 显式批准 trust 边界,不做 auto-allow**。实测踩 4 个坑陆续修通(v1 vs v2 SDK / patch 不刷新视觉 → delete+send / parentID 约束防 reject 回放上轮答案)
- **feishu-bridge-system-prompt-disable-question** + **feishu-server-loopback-bind** + **network-bind-safety-guard** + **feishu-bridge-completion-signal-rewire** ([4 笔机制 fix changelog 见各自 features/](features/),merge `183183119`)— ① 注入 system prompt 禁 LLM `question` 反问工具(修 agent loop 死锁,user 在飞书无法回答的场景)② plugin server bind 127.0.0.1 only(Win Firewall "Bun" 弹窗消除) ③ R6 网络监听安全规则 + pre-commit 4.5 hook 拦截 `Bun.serve(` 默认 0.0.0.0 ④ Layer 2 dispatcher 切换尝试 revert(opencode 多 assistant 消息序列锁第一条问题暴露,Layer 2.1 backlog)
- **office-installer-mirror-cascade** (`2d54b184d`)— LibreOffice 自动安装 mirror cascade fallback,单 mirror 失败不再 break 整流程(R4 override 延续 office 引擎 fork-only 链)
- **pack-installer-rebuild-step** ([changelog](features/pack-installer-rebuild-step/3-changelog.md),merge `b91e5f353`)— `pack-installer.ps1` 加 step 1.5 自动重 build,修 bump→build→ISCC 顺序错位 SOP bug(本笔 ship 即首次实战验证 — UI 版本号跟 installer 文件名对齐)

**Installer**:`packages/branding/installer/Output/DeskFox-2026.5.11.1-setup.exe`(62,263,972 bytes / 59.4 MB)

**配套 plugin**:`packages/branding/plugin/feishu-bridge/dist/`(plugin 已 bundle 进 installer,无独立分发)

**user 实测验证**(本笔 ship 即验证场景):
- ✅ 安装包文件名 `DeskFox-2026.5.11.1` + 装出来 UI 左下角显示 `v2026.5.11.1` 对齐(pack-installer fix 修通)
- ✅ 飞书 user 任务遇 opencode 权限请求 → 飞书侧弹交互卡片 → 点[允许一次]后 LLM 解锁继续,settled 卡片绿色 + 移除按钮
- ✅ user 点[拒绝]后,本轮无 useful assistant text → plugin 不回飞书,不再回放上一轮答案
- ✅ "始终允许"路径真飞书实测通过(2026-05-11 user 复测)
- ⏳ Mac 端跟随 ship 未启动(本笔仅 Win)

**Release**:等 user 决定走 GitHub Actions release-deskfox.yml workflow(push `ship-prod-2026.5.11.1` tag 触发)还是仅本地存档

**上游 baseline**:跟 dev 同步(sync-2026-05-03-2 后基线,~1.14.x + 上游推进)

---

## [Windows] 2026.5.10.1 - 2026-05-10 11:54

**主题**:飞书桥接 v1 首发 ship — adapter / OAuth Device Flow / WSS / plugin 架构 + Inno Setup 加 plugin bundle(让首装即用)

自 [`ship-prod-2026.5.9.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.9.1) 以来 dev 主干推进约 65 commits,主要 feature:

- **feishu-bridge** ([changelog 系列](features/) — `feishu-bridge` / `feishu-bridge-newuser-onboarding` 等多 feat 协同)— 飞书 IM 接入 opencode 的完整桥接 v1:adapter-feishu-lark workspace(SecretRef 三档凭证 + zod config schema + opencode HTTP client + OAuth Device Flow + localhost server + WSS 长连接 + chatQueue 串行 + FlushController CardKit/Patch 双路径节流 + DedupCache LRU)/ 桌面 system tray + close GUI ≠ exit + Tauri commands / Settings 飞书桥接 Tab + i18n 三本字典 + 扫码绑定弹窗 / chat-session-store(chatId → sessionID 持久化映射)/ per-account model 编辑 + hot reload / plugin + server(architecture X1:plugin 自带 server 多 IM 演进路径)
- **feishu-installer-bundle-plugin** (`39e487f75`,本笔 bump commit)— Win Inno Setup `DeskFox.iss` 加飞书 plugin bundle,prod installer 打 `packages/branding/plugin/feishu-bridge/dist/` 进 resource_dir,装完插件直接可用(修 bug-repro:之前 installer 不打 plugin → resource_dir 找不到 plugin → 飞书桥接永远显示"未启动")
- **feishu-bridge-empty-reply-ghost** ([changelog](features/feishu-bridge-empty-reply-ghost/3-changelog.md),merge `9ccaa391e`)— 5 条丢失 reply 修复(ghost filter + timeout 30min)

**Installer**:`packages/branding/installer/Output/DeskFox-2026.5.10.1-setup.exe`(61,462,332 bytes / 58.6 MB)

**user 实测验证**:
- ✅ 装出来飞书桥接 Settings 可见,OAuth 扫码绑定走通
- ⚠️ **已知 UI 版本号 mismatch bug**(本笔触发后立修)— user 装 .10.1 后想再 ship .11.1,跑 `pack-installer.ps1` 出 `DeskFox-2026.5.11.1-setup.exe`,但脚本顺序错位(先 bump JSON 再 ISCC 编但中间没 rebuild exe)导致**文件名 .11.1 + 内部 UI 仍 .10.1**。本版本身 .10.1 文件名 + UI 一致,可用。但触发 `pack-installer-rebuild-step` 修(见 [`2026.5.11.1`](#windows-2026511---2026-05-11-0815))

**Release**:本地存档,未上 GitHub Release(快速被 [`2026.5.11.1`](#windows-2026511---2026-05-11-0815) 取代)

**上游 baseline**:跟 dev 同步

---

## [Windows] 2026.5.9.1 - 2026-05-09 10:19

**主题**:MD → Word 导出第二轮迭代 — 全面保真度提升([feat: md-export-word-iter-2](features/md-export-word-iter-2/3-changelog.md),merge `ae96d138b`)

**包含 commit**(6 笔):
- `185ad127c` feat(desktop): fetch_url_base64 后端命令(远端图片走 Tauri reqwest)
- `194172129` chore(deps): 加 katex@0.16.45 + mathml2omml@0.5.0(数学公式 OMML 路径)
- `f5b22a840` feat(ui): viewer marked 4 个扩展(<mark>/emoji/heading anchor/嵌套 link 图片)
- `a8030f1f3` feat(md-export-word): docx 主体 — 15+ helper(HTML 标签/Alerts/blockquote/图片/表格/数学/目录跳转)
- `bfb6ca503` test(md-export-word): 单测 72 → 147
- `b2740f19a` docs(features): 三文档 + 索引

**用户可见亮点**:
- HTML 标签全转 Word 元素 + GFM Alerts 5 类彩色独立块 + blockquote 同段一体
- 远程图片自动嵌入 / 表格全边框 + header 灰底 / Mermaid 居中
- **数学公式 LaTeX → Word 原生公式可编辑可矢量**(KaTeX→MathML→OMML 路径)
- 目录 Ctrl+点击跳转 / ==高亮== 黄底 / GFM emoji shortcode / Word default 字号行距

**已知 deferred**(2 项,详见 OPENCODE-PLAN/需求池/):积分公式 ∫ 后占位框 + save dialog 默认按钮

**Installer 路径**:`build/installer/DeskFox-2026.5.9.1.exe`(GitHub Actions CI 产出)
**回退方法**:`git revert ae96d138b`

---

## [macOS] 2026.5.7.1 — 2026-05-07 14:18

(to be filled: commits / plugin / installer path after ship)

---
## [Windows] 2026.5.6.2 - 2026-05-06 15:25

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

---

## [Windows] 2026.5.6.1 - 2026-05-06 15:23

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

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
