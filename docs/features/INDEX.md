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
