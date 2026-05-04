# Features 索引

> 规范 v2(2026-04-27)起,每个 feature 一个目录,含 1-spec / 2-plan / 3-changelog 三文档。
> 详情见 [`CLAUDE.md`](../../CLAUDE.md) 的"完整文档链路"段。

| feat-id | 状态 | 简介 |
|---|---|---|
| [file-tree-dnd](./file-tree-dnd/) | done | 文件树拖放移动 — 全功能(核心+多选+剪切粘贴+撤销+外部拖入) |
| [getbot-接入](./getbot-接入/) | done | GetBot 模型聚合 Provider 接入(热门首位 + 推荐标 + 内置 apiKey 流程) |
| [规范-v2](./规范-v2/) | done | 三文档分离 + diff 阈值放宽 + 注册型扩展点出黑名单 |
| [加聊天-preview-fix](./加聊天-preview-fix/) | done | 文件查看器右键加聊天后选中文字未传到模型 — synthetic text 里带 preview |
| [查看器-自动刷新](./查看器-自动刷新/) | done | 模型 Edit/Write 后查看器不更新 — client 加 file.edited 监听 + 编辑态 dirty 守卫 |
| [禁自动升级](./禁自动升级/) | done | 关闭 opencode 官方自动升级入口和通道,防止 DeskFox 被覆盖 |
| [installer-打包](./installer-打包/) | done | DeskFox 打成 Windows installer(不签名)— Inno Setup 路线;顺手修 icon pipeline bug 让 exe 嵌入多分辨率狐狸 |
| [icon-pipeline-deep-fix](./icon-pipeline-deep-fix/) | done | Tauri winres 实只读 icons/dev/icon.ico、无视 prod.json override — apply-icons 同步覆盖 dev/ + 新设计资源全量更新 |
| [macos-打包](./macos-打包/) | done | DeskFox 打 macOS .app + .dmg(arm64,不签名)— Phase 1 scaffolding + Phase 2 user Mac 实战打通 |
| [claude-code-loop-fix](./claude-code-loop-fix/) | done | 修 claude-code plugin 选 Claude 模型时 step loop 不 break、UI 卡死 — 兜底块用 step-finish part 替代 finish 顶层字段(R4 override,case 1) |
| [build-pipeline-sidecar-fix](./build-pipeline-sidecar-fix/) | done | Windows build-deskfox.ps1 加 sidecar 自动 build 步骤 — 时间戳判断 + non-baseline 优先(绕 clash 代理下 bun-baseline 下载失败) |
| [plugin-cwd-channel](./plugin-cwd-channel/) | done | opencode 加 _opencode providerOptions namespace 暴露 cwd 给 spawn-based plugin(R4 第 3 笔本季特批,不扣下季度配额) |
| [installer-versioning](./installer-versioning/) | done | installer 版本号规则 YYYY.M.D.N(年.月.日.当天第几版)+ bump 脚本 + pack-installer 一键脚本 + docs/installer-versions.md 版本日志 |
| [md-viewer-typography](./md-viewer-typography/) | done | 文件查看器看 .md 时排版升级 — 标题阶梯(字号+加粗双轨,h1/h2=700,h3-h6=600)/ 行内代码芯片 / 引用块底色 / HR 显形 / 表头底色,scoped 在 data-context="file-viewer" 下,聊天侧零影响 |
| [bump-script-encoding-fix](./bump-script-encoding-fix/) | done | bump-installer-version.ps1 加 UTF-8 BOM 修中文 placeholder 乱码(PS 5.1 源解析陷阱)|
| [macos-右键选区-修复](./macos-右键选区-修复/) | done | macOS WKWebView 文字上右键选区丢失 — 选区历史栈挑最长 + overlay div 替代 stale 的 CSS Custom Highlight + 关闭菜单时统一清原生/Pierre 选区 |
| [加聊天-option-enter](./加聊天-option-enter/) | done | 文件查看器"+ 添加到聊天窗口"对话框 macOS 加 Option+Enter 提交快捷键 + 底部提示文案平台化(Tiny) |
| [macos-pack-installer](./macos-pack-installer/) | done | macOS 一键打 .app/.dmg 脚本(pack-installer.sh + bump-installer-version.sh)+ icon.icns 加 .gitignore + 4 个 sh +x 权限(Tiny) |
| [office-installer-macos](./office-installer-macos/) | done | LibreOffice 自动安装 macOS 适配 — DMG 下载 + hdiutil 挂载 + cp -R 到 ~/Applications + soffice 检测路径(Tiny,fork-only,纯增量) |
| [prod-bundle-id-fix](./prod-bundle-id-fix/) | done | macOS prod / beta Bundle ID 独立 override(prod=ai.opencode.desktop,beta=...beta),修应用程序网格搜不到 .dev Bundle ID 应用的问题(Tiny) |
| [bundle-id-debrand](./bundle-id-debrand/) | done | 完整品牌切割 — Bundle ID 三档全去 `opencode` 字眼,改 `ai.deskfox.app` 系列(prod/.beta/.dev),与 sst/opencode 上游 0 命名空间共享(Tiny) |
| [分支策略-v2](./分支策略-v2/) | done | dev 单一稳定主干 + 上游同步分离 + 三档环境正交分支 — feat → dev 一次性 merge 切换(`fae01d2a8`,187 文件 / +19721 行),废除 4.3 节"禁止直 push 到 dev",origin 双 push 临时改单推 gitee |
| [win-tri-env-appid](./win-tri-env-appid/) | done | Windows 三档 AppId 同机共存 — `DeskFox.iss` 加 `#if AppEnv` 切档(beta `{86413DCA-...}` + dev `{4C5D29F2-...}` 新生成,prod GUID 锁死不变);`pack-installer.ps1` 加 `-Env` 参数;Mac/Win 三档共存能力对齐 |
| [数据目录-deskfox-隔离](./数据目录-deskfox-隔离/) | spec | DeskFox 与上游 opencode 共用全部数据目录(auth/sessions/config/cache/install_id),两档实施:Phase 1 install_id 独立(fork-only,3 行)/ Phase 2 全量隔离(改上游 R3);从隐私协议 v0.5 待办挪入 |
| [post-sync-build-fix](./post-sync-build-fix/) | done | sync/upstream-2026-05-02 merge 后两个 latent build bug 浮出 — Windows symlink 落空(`.d.ts` 转真文件 + triple-slash reference,R4 override)+ Bun baseline runtime ~190MB 下载绕过(build-deskfox.ps1 直接 build --single 跳 predev.ts) |
| [dev-typecheck-fix](./dev-typecheck-fix/) | done | dev typecheck 555 错根因 — sync abort 后 node_modules symlinks 没 rollback 到 lock,同 codebase 看到两份 effect 类型;`bun install` 修(0 代码),并把 abort 后必跑 reconcile 写进 UPSTREAM-MERGE-GUIDE §5.0 / §7 / TL;DR |
| [zod-schema-bridge](./zod-schema-bridge/) | done | 上游 sync prep — office-pdf-ref 从 schema enum 抽离到 fork-only vendor MIME 协议(`application/x-deskfox-pdf-ref`),producer + consumer 都改走 `@opencode-ai/shared/office-pdf-protocol`;`Content` schema 上 fork 字段值依赖归零,以后上游改 Content 0 冲突;R4 override 第 2 笔本季 |
| [updater-disable-adapter](./updater-disable-adapter/) | done(rolled back) | 上游 sync prep — 禁自动升级走法从"条件 spread 藏 UI"改成"上游 sentinel + menu 灰显"风格;**翻车** UX 回归(立即检查按钮变可点击 + 假 toast),被 `updater-disable-adapter-rollback` 撤回;constants.rs 注释更新保留 |
| [updater-disable-adapter-rollback](./updater-disable-adapter-rollback/) | done | 撤回 `updater-disable-adapter` 的 createPlatform sentinel + menu 灰显改动,恢复 conditional spread 模式(method undefined when off → controls 自动 disable);constants.rs 注释保留;UPSTREAM-MERGE-GUIDE §4.4 表格 + 教训段沉淀:**改 method 暴露策略前先 grep `disabled={!platform.<method>}` 类多重信号 callsite** |
| [sync-2026-05-03-aborted](./sync-2026-05-03-aborted/) | done | 上游 sync 实战 abort 复盘 — 8 个 conflict 全 resolve 后撞 SDK 双路径互斥(httpapi vs hono 二选一);过程中踩 `bun.lock` 自由 resolve 坑(`poe-oauth: *` → mcp-oauth bug);全 lessons 沉淀到 UPSTREAM-MERGE-GUIDE §4.7(lock 处理方法学)+ §7(2 行新踩坑)+ TL;DR(2 条);决策走 office-routes-effect-httpapi(下笔 spec) |
| [office-routes-effect-httpapi](./office-routes-effect-httpapi/) | done | fork 4 个 office routes(`/file/office-pdf` + `/office-tooling/{status,install,progress}`)从 Hono 迁到 Effect HttpApi PublicApi,httpapi-mode SDK 含 fork office method;实施在 sync-2026-05-03-2 期间(新建 `file-office.ts` 集中 schema + groups/handlers FORK block);老 Hono routes 暂留(共存,follow-up 删) |
| [win-bun-install-fix](./win-bun-install-fix/) | done | Windows `bun install` 不再被 `tree-sitter-powershell` postinstall 阻断 — 上游 `trustedDependencies` 列了它但 fork+upstream 都只用 wasm(native binding 0 用),且 `tree-sitter-powershell@0.25.10` 不发 Win prebuilds → 必走 fallback 编译 → Windows 没 VS Build Tools 报错。fix:root `package.json` 删该 entry(R4 第 3 笔本季,超 1 笔配额,user 明确授权);typecheck 15/15 + DeskFox.exe build 通过;pre-push 安全网恢复 |
| [sync-2026-05-03-2](./sync-2026-05-03-2/) | done | 本季 sync 实战成功 — 462 commits / 1157 文件 / +58k/-53k merge 完成;早上 abort 的 SDK 双路径互斥被 office-routes-effect-httpapi 解锁;`bun.lock` 走新 §4.7 take theirs 绕开 mcp-oauth 坑;9 个 fork 文件现场调整(import path adapt + Instance→InstanceState.context 适配);typecheck 15/15 + DeskFox.exe build 通过;0 R4 |
| [release-mac-ci](./release-mac-ci/) | done | GitHub Actions 自动打 macOS .dmg(arm64,不签名)— 新增 `release-mac-deskfox.yml`,push `ship-mac-(prod\|beta)-*` tag 触发,与 Win workflow 独立;复用 mac 端现有 build-deskfox.sh + workflow 内自带 .dmg 重命名 |
| [repo-migration-deskfox](./repo-migration-deskfox/) | done | 主仓从 `yuesoue/opencode-for-office-deskfox`(无 fork 关系)迁到 `zoulukuang/deskfox`(真 fork from anomalyco/opencode;owner 名 2026-05-04 由 `yuesoue` 改名得来,详见 user-rename-zoulukuang);修品牌诚信 + 解锁上游 PR 工作流;dev + 全 tag push,4 处 docs URL 更新,老仓 dev 加 deprecation banner;Mac 端 origin 切换 / Gitee 镜像迁 / 老仓 archive 留 backlog |
| [user-rename-zoulukuang](./user-rename-zoulukuang/) | done | GitHub user 改名 `yuesoue` → `zoulukuang`(对齐 Gitee 用户名);本地 origin / origin-legacy URL 切到 zoulukuang;5 处活跃 docs URL 更新;老仓 deprecation banner URL 改名;改名后立即注册 yuesoue 空号防 squat(Tiny) |
| [gitee-release-mirror](./gitee-release-mirror/) | done | GitHub Release publish 后同步到 Gitee Release — **混合方案**:workflow `release-mirror-gitee-deskfox.yml` 镜像元数据(tag/name/body,30s)+ 本地脚本 `mirror-asset-to-gitee.ps1` 上传 .exe 附件(5.5s,76Mbps);3 次实测后发现 GitHub US runner 上行 Gitee CN 50MB 被 GFW 节流到 30min timeout,pivot 让本地 IP 干上传活;首次实测 `ship-prod-2026.5.3.1` 全链路通(workflow 创 release_id=669251 + 本机秒传 .exe);**2026-05-04 续笔**:补 Mac `mirror-asset-to-gitee.sh`(~230 行 bash,镜像 .ps1 逻辑,自动定位 .dmg + GitHub fallback 下载 + jq 解析,跨平台 stat,文件 mode 100755),Mac 协作者拉 dev 实测 `ship-mac-prod-2026.5.4.1`(GitHub draft 待 publish 后跑) |
| [readme-deskfox-自家版](./readme-deskfox-自家版/) | done | GitHub 主仓 README 从上游 OpenCode 完整重写为 DeskFox 自家版 — **英文主 `README.md` + 中文 `README.zh.md`**(2026-05-04 修订,因国外申请数字签名期间英文更合适;原计划中文主)— 匹配 deskfox.ai 站点定位 / 品牌 / URL;删 21 个上游 locale README;复制 1 个 logo SVG + 4 张产品截图(hero + PDF/PPT/视频 预览)到 `docs/assets/`;走 feat 分支迭代 + GitHub 上预览审稿(DeskFox 自家 markdown preview 不渲染本地图,backlog);merge dev 后删 feat 分支;后续修订英文化直接 dev |
