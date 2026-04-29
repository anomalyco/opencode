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
