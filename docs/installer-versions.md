# DeskFox installer 版本日志

> 版本号规则:`YYYY.M.D.N`(年.月.日.当天第几版,N 从 1 开始)
> **Windows 和 macOS 各自独立 N 序列**(同一天 Win 打 1 次 + Mac 打 2 次,版本号分别为 [Windows] X.1 + [macOS] X.1, [macOS] X.2,**不共享计数器**)
> 每次跑 `pack-installer.ps1`(Windows)/ `pack-installer.sh`(macOS,待补)自动 bump + 编译,产生一条新 entry。
> 这个文件**只记录 ship 出去的 installer 版本**,不等同于 git commit。
> commit 索引看 [`改动日志.md`](改动日志.md)。

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
