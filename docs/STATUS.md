# 实施状态

> 这是 [./history/规划-archive/08-最终策略与实施清单.md](./history/规划-archive/08-最终策略与实施清单.md) 的**活版本**。08 是静态规划（订立后不改），本文档持续更新：每个 Phase 的当前状态、已打勾项、blocker、实际耗时 vs 估算、发现的新问题。

**图例**：⏳ 未开始 / 🟡 进行中 / ✅ 完成 / 🚫 已放弃 / ⚠️ 阻塞中

---

## 整体阶段总览

| Phase | 目标 | 估算 | 实际 | 状态 |
|---|---|---|---|---|
| Pre-1 | 规划文档成稿 | — | — | ✅ |
| Pre-2 | sst/opencode 仓库调研 | — | — | ✅ |
| Pre-3 | Issue 素材就位 | — | — | ✅ |
| Pre-4 | 提交 Issue | 0.5 天 | — | 🚫 暂搁（用户 2026-04-24 决定：先只做轨道 2 MVP，上线后据反馈再评估轨道 1） |
| Phase 0 | 独立 prototype 验证链路 | 0.5-1 天 | ~0.5 天（2026-04-23/24） | ✅ L1-L4+L6 过，L5/L7 挂账 |
| Phase 1 | fork + 本地构建 + 关键风险验证 | 1-3 天 | ~1 天（2026-04-23 → 24） | ✅ `@pierre/diffs` 已验证 Apache-2.0 可拉 |
| Phase 2 | 核心改动（FileTabContent 分支渲染） | 2-4 天 | ~4 小时（2026-04-24） + ~5 小时（2026-04-25 .md 渲染 + 右键加聊天 + 编辑入口收口 + 内联音频/视频预览） + ~3 小时（2026-04-25 office 文档预览）+ ~3 小时（2026-04-25 文件树右键菜单完整文件操作） | ✅ 静态 + runtime 全过 |
| Phase 3 | 保存 + 冲突处理（mtime / dirty 拦截 / 防呆） | 1-2 天 | ~3 小时（2026-04-24） | ✅ 核心 4 项过（mtime 冲突 / readonly / 二进制 / 大文件）；dirty 切 tab 和 关窗口拦截挂账 |
| Phase 4 | 小范围分发打包 | 1-2 天 | ~1 小时（2026-04-24） | 🟡 debug exe 可跑 + 已归档；NSIS bundler 挂账（SignTool missing） |
| Phase 5 | 长期维护 | 每月 2-5 天 | — | 未进入 |

**MVP 目标**：Phase 0-4 串完，产出可装的 exe，6-12 天（1.5-2.5 周）。**实际 2 个日历日达成 MVP v1.2**（2026-04-23 启动 → 2026-04-24 Phase 3 Save 安全护栏全通）。

**MVP v1.2 锚点**（2026-04-24，含 Save 安全护栏 — 当前推荐分发版）:
- Fork: `gitee:zoulukuang/opencode-for-office` + `github:yuesoue/opencode-for-office` 分支 `feat/editable-file-viewer`
  - commit `4097f6830`（Phase 3 Save 安全护栏 #6，mtime/readonly/binary/大文件）
  - tag `mvp-v1.2-save-safety` → 4097f6830（**推荐发朋友圈**）
  - tag `mvp-v1.1-savefix` → 42aea0234（Save 相对路径 + reload 修复）
  - tag `mvp-v1-runtime-ok` → cb5460321（Phase 4 runtime 初次验收）
- 本地 artifacts: `D:\artifacts\opencode-mvp-v1-release\{OpenCode.exe 25MB, opencode-cli.exe 152MB, opencode_lib.dll 455KB}` — 总 178 MB，**无 console 的 release 版**

**分支前沿**（2026-04-25，未单独打 tag，未归档 artifacts）:
- commit `14f8a7992`（改动日志 #7，.md 渲染预览 + 右键添加到聊天 + 编辑入口收口）
- commit `f33618d91`（改动日志 #8，**内联音频/视频预览 + 系统播放器兜底**）
- commit `66c8fa523`（改动日志 #9，**office 文档预览** — LibreOffice → PDF + pdfjs + onboarding 多镜像测速安装,~1700 行 staged diff）
- commit `<本次>`（改动日志 #10，**文件树右键完整菜单** — 7 项行菜单 + 3 项空白区菜单 + 选中态高亮 + 删除走系统回收站,~480 行 staged diff;watcher.ts 顺带留 2 行 `console.debug` 给 B 部分诊断,下次会话修)
- gitee + github 双 push 已落地（#7-#9）；#10 未 push,等 user 拍板
- release exe 在 `D:\project\opencode-fork\packages\desktop\src-tauri\target\release\OpenCode.exe`，user 手测全部回归点过；如需固化分发版可打 `mvp-v1.4-file-ops` tag + 复制到 artifacts

---

## Pre-4 — 提交 Issue 🚫 暂搁

### 目标

把 `GitHub-Issues/` 下两份素材提到 sst/opencode，为轨道 1（争取官方合入）铺路。

### 检查清单

**Issue 01 — 可编辑文件查看器**

- [ ] 搜 sst/opencode issues：`editable`, `edit file`, `text viewer`, `file tab edit`, `CodeMirror`
- [ ] 确认无高度重复 issue
- [ ] 决定中文 / 英文（默认英文，sst 团队主语言）
- [ ] 本地至少跑通 Phase 0 prototype 再发（避免"可提 PR"成空头支票 → 建议 Phase 0 完成后再提）
- [ ] 提交后在 `沟通记录.md` 记录 issue 号 + 链接 + 日期

**Issue 02 — 文件树不自动刷新**

- [ ] `gh issue view 23616 --repo sst/opencode` 核对原文，判断走路径 A（评论）还是 B（独立 issue）
- [ ] 同步查看 #23321 / #19182 / #18504 的最新评论
- [ ] 本地亲跑「未展开目录 + 外部 touch」复现一次
- [ ] 路径 A：发评论；路径 B：发独立 issue（标题必须带 "Bug:" 前缀）
- [ ] 提交后记录到 `沟通记录.md`

### Blocker

- **Issue 01 的发送时机**：建议 Phase 0 prototype 跑通后再发，避免"可提 PR"承诺落空。可以先发 Issue 02（小改动、可独立推进）。

### 本日更新日志

- **2026-04-24** — 用户决定先只做轨道 2 MVP。本阶段转为"暂搁"：素材保留（`GitHub-Issues/issue-01/02`），等 MVP 发朋友圈拿到反馈后再评估是否重启。

---

## Phase 0 — 独立 prototype ✅

### 目标

在独立目录（不动 opencode 本体）验证**技术链路可行性**：SolidJS + CodeMirror 6 + Tauri `read_text_file` / `write_text_file` 端到端跑通。

### 位置

`opencode-plan/prototype/`（本仓库子目录，方案 B；2026-04-23 决定从原计划 `D:\project\...` 改到这里，因为开发环境是 Linux，目标平台是 Windows + macOS，CI 兜底）

### 步骤

- [ ] `bun create solid` → TypeScript template
- [ ] 装 CodeMirror 6 依赖（`@codemirror/state` `@codemirror/view` `@codemirror/commands` `@codemirror/lang-markdown` `@codemirror/lang-javascript` `@codemirror/language`）
- [ ] `bun add @tauri-apps/api @tauri-apps/cli` + `bun tauri init`
- [ ] 最小页面：文件路径输入 + 加载按钮 + CodeMirror 区 + 保存按钮
- [ ] Rust `read_text_file` / `write_text_file` command

### 验收 — 三平台矩阵

> 开发在 Linux，目标 Windows + macOS。Linux 跑得通 ≠ Windows 跑得通（WebKitGTK ≠ WebView2，IME / 字体行为不同）。所以验收必须分三栏。

#### Linux 本地（每次改动后必跑）

- [ ] L1: `bun run tauri dev` 能起，主窗口出现
- [ ] L2: `read_text_file` 通，CodeMirror 显示文件内容
- [ ] L3: `write_text_file` 通，外部 `cat` 看到变化
- [ ] L4: 写盘 hex 对比一致（仅目标字节差，无编码污染）
- [ ] L5: CodeMirror mount/unmount 100 次无 DOM 泄漏（DevTools Memory snapshot）
- [ ] L6: `.md` 语法高亮正常
- [ ] L7: 5MB `.md` 文件流畅（滚动 / 编辑 / 选区）

#### Windows CI / 真机（Phase 0 验收兜底）

- [ ] W1: GitHub Actions Windows runner，`tauri dev` 编译 + 启动
- [ ] W2: `tauri build` 出 NSIS `.exe`，artifact 上传
- [ ] W3: CI 跑 hex 对比写盘
- [ ] W4: ⛔ 真机手测：**中文 IME 候选词正常**（WebView2 下，Windows IME 是历史坑王）
- [ ] W5: ⛔ 真机手测：Windows readonly attribute 检测
- [ ] W6: ⛔ 真机手测：CodeMirror 在 WebView2 下渲染 OK（字体 / IME 行为）

#### macOS CI / 真机

- [ ] M1: GitHub Actions macOS runner，`tauri dev` 编译 + 启动
- [ ] M2: `tauri build` 出 `.dmg`，artifact 上传（签名留空，朋友圈分发足够）
- [ ] M3: CI 跑 hex 对比写盘
- [ ] M4: ⛔ 真机手测：中文输入法候选词正常（WKWebView）
- [ ] M5: ⛔ 真机手测：macOS POSIX 文件权限处理

⛔ 真机手测项**暂时挂账**，等借到 Windows / macOS 机器再补，或部分通过远程虚机覆盖。

### baseline tag 计划

| tag | 时机 |
|---|---|
| `proto-skeleton` | bun create + tauri init 完成，能起空窗口 |
| `proto-cm-mounted` | CodeMirror mount 显示文件内容（L1-L2 过） |
| `proto-save-works` | 保存写回磁盘（L3-L4 过） |
| `proto-l-all-pass` | L1-L7 全过，可进 Phase 1 |

### Blocker

- **CI 平台未定**：本仓库托管在 gitee，GitHub Actions 不可用。Phase 0 prototype 的三平台 CI 需要镜像到 GitHub 才能跑（或者把 prototype 拆出去单独建 GitHub 仓）。等 prototype 跑通 L1-L7 后再决定。
- **项目路线变更（2026-04-24）**：用户决定全程在 Windows 本机开发 + 验证，放弃 Linux 开发环境。macOS 手测挂账；L5/L7 也不再追求三栏矩阵，Windows 本地通过即算 prototype 过关。

### 本日更新日志

- **2026-04-23** — 目录骨架已建：`prototype/{src,src-tauri/src/commands}` + `README.md` + `改动日志.md`。源码未生成（等显式 `bun create` 指令）。三平台验收矩阵已就位。
- **2026-04-24** — Phase 0 全部完成。路线简化为 Windows 单机。
  - `bun create solid` → Vite TS 模板 → 手工加 CodeMirror 6 一组 + `@tauri-apps/api` → `bun tauri init`
  - `src-tauri/src/commands/file.rs` + `lib.rs` 注册 `read_text_file` / `write_text_file`
  - `src/App.tsx` + `src/components/code-mirror-view.tsx` + `src/utils/lang-from-ext.ts`
  - `bun run tauri dev` 启动成功；user 亲验 Load 595-byte `.md` + 改字 + Save 磁盘字节级 hex 对比干净（仅目标字节差，末尾 LF，无 BOM/CRLF 污染）
  - 修一轮 CM6 syntaxHighlighting + markdown nested code（typescript 块可读性 OK）
  - commit `40b2e37`（opencode-plan 仓）+ tag `proto-l-all-pass`
  - **L1-L4 + L6 ✅**；L5 mount/unmount 100 次、L7 5MB 流畅 **挂账**（走 B 路径，runtime 验证由 Phase 4 的 exe 一并兜底）

---

## Phase 1 — fork + 本地构建 + 关键风险验证 ✅

### 目标

把 sst/opencode 源码搞到 gitee 自有仓库，本地能跑起来，**确认 `@pierre/diffs` 可以 `bun install`**（这是最大阻塞风险）。

### 步骤（2026-04-23 大幅修订：从 GitHub fork 改为 gitee 主仓 + GitHub upstream 只读）

- [x] **2026-04-23** clone sst/opencode dev 分支到 `~/projects/opencode-fork/`（344MB，gitee 1GB 内安全）
- [x] **2026-04-23** 打 `upstream-baseline` tag 作为 baseline 锚点
- [x] **2026-04-23** remote 切换：`origin` 重命名为 `upstream`（GitHub，只读）；新增 `origin` 指向 `gitee.com/zoulukuang/opencode-for-office`
- [x] **2026-04-23** push dev + 所有 tag 到 gitee origin
- [x] **2026-04-23** fork 仓 bootstrap 提交 `623579217`：`.gitattributes` + `.husky/pre-commit`（3 道护栏）+ `scripts/install-hooks.sh` + `改动日志.md`
- [ ] 建 feature 分支 `feat/editable-file-viewer`（基于 dev）
- [ ] **Linux 端**装环境：rustup + bun + libwebkit2gtk-4.1-dev 等（详见 `./governance/跨平台协作.md` 节 5.1）
- [ ] **Windows 端**装环境：MSVC Build Tools 2022 + Windows SDK + WebView2 Runtime + Rust + bun（详见 节 5.2）
- [ ] `bun install`（先 Linux 端跑），**关键验证点**：`@pierre/diffs` 能否拉取
  - [ ] ✅ 能拉 → 继续 Phase 2 + 验证 husky 装好 hook：`bash scripts/install-hooks.sh`
  - [ ] ❌ 拉不到（401/404） → 触发 **Plan B**：完全重写 file.tsx，不用 PierreFile（+2-3 周）
- [ ] `cd packages/desktop && bun run tauri dev` Linux 端复现官方行为
- [ ] Windows 端从 gitee pull 后重复上述（验证跨平台一致性）

### 上游同步流程（每 2-4 周一次，详见 fork 仓 `改动日志.md` 顶部）

```bash
git fetch upstream
git tag pre-rebase-$(date +%Y-%m-%d) dev
git checkout dev && git rebase upstream/dev
git push origin dev --force-with-lease
```

### Blocker

- ~~`@pierre/diffs` 访问权限是项目最大风险~~ — **2026-04-24 已解除**：该包是 Apache-2.0 开源 npm 包，`bun install` 直接拉到。Plan B（重写 file.tsx）永久不需触发。
- 跨平台 EOL/编码的 hook 在 `bun install` 之前**未生效**（husky prepare 自动装），首次 install 后才有保护。→ 已随首次 `bun install` 自动生效。

### 本日更新日志

- **2026-04-23（晚）** — 已完成 clone + remote 切换 + bootstrap 推 gitee。fork 主仓 = gitee.com/zoulukuang/opencode-for-office。upstream = github.com/sst/opencode（只读）。下一步：用户决定立刻 `bun install`（Linux）还是先开 Phase 0 prototype。
- **2026-04-24** — 整个 Phase 1 完成。路线调整为 Windows 本机（放弃 Linux 开发）。
  - fork 仓 `git clone` 到 `D:\project\opencode-fork\`（跨机器迁移），remote 配好 origin=gitee / upstream=github。
  - Windows 端装齐：bun 1.3.13、rustup + Rust 1.95.0（stable MSVC host，装 D:\tools\cargo/D:\tools\rustup）、MSVC Build Tools 2022 + Windows 11 SDK（D:\tools\VSBuildTools）、WebView2 Runtime（系统自带 147.0.3912.72）。
  - `bun install`（配 `ELECTRON_MIRROR` 国内镜像绕 electron postinstall ECONNRESET）通过，2410 installs / 2671 packages。
  - **@pierre/diffs 验证通过**：`bun.lock` line 1787 完整 resolve sha512，`node_modules/.bun/@pierre+diffs@1.1.0-beta.18+*` 物理存在，package.json 显示 Apache-2.0 license → **项目最大风险解除，Plan B 永久退役**。
  - 建 `feat/editable-file-viewer` 分支。
  - Rust smoke test（cargo new + cargo build + 跑 hello world exe）通过 → MSVC 链接器自动被 cargo 正确找到。

---

## Phase 2 — 核心改动 ✅

### 目标

在 fork 里实现 `FileTabContent` 分支渲染：非编辑态走原 `PierreFile` 路径，编辑态走新的 `CodeMirrorView`。

### 关键改动文件

| 文件 | 操作 |
|---|---|
| `packages/app/src/pages/session/file-tabs.tsx` | 改：FileTabContent 加 editing state + 工具条 + 渲染分支 |
| `packages/app/src/pages/session/session-side-panel.tsx` | 改：编辑态隐藏 Line Comment Layer，未保存拦截切 tab |
| `packages/app/src/components/code-mirror-view.tsx` | 新增：SolidJS 包 CodeMirror 6 |
| `packages/app/src/utils/lang-from-ext.ts` | 新增：按扩展名选 CodeMirror language |
| `packages/app/package.json` | 改：加 CodeMirror 依赖 |
| `packages/desktop/src-tauri/src/lib.rs` | 改：注册 `write_text_file` command |
| `packages/desktop/src-tauri/src/commands/file.rs` | 新增：写文件 command 实现 |

### 防呆项（必做）

- [ ] 二进制文件禁用编辑按钮（png/jpg/exe/zip 等）— **挂账到 Phase 3**
- [ ] 文件 > 10MB 禁用 — **挂账到 Phase 3**
- [ ] 只读文件（Windows readonly attribute）禁用 — **挂账到 Phase 3**
- [ ] dirty 状态下切 tab / 关 tab / 关程序 → 弹未保存提示 — **挂账到 Phase 3**
- [x] 切 tab / 路径变化 → 重置 editing（`createEffect on path`）✅

### Blocker

_（无，已全部清）_

### 本日更新日志

- **2026-04-24** — 整个 Phase 2 完成。
  - Rust：`src-tauri/src/text_file.rs` 新增 `write_text_file`（`#[tauri::command] #[specta::specta]`），`lib.rs` 加 `mod text_file` + `collect_commands!` 注册。
  - 前端：`packages/app/src/components/code-mirror-view.tsx`、`packages/app/src/utils/lang-from-ext.ts` 从 prototype 移植（适配 monorepo + catalog deps 风格）。
  - `packages/app/src/pages/session/file-tabs.tsx` `FileTabContent`：
    - 加 `editing`/`draft` signals + `dirty` memo + `canEdit`（`window.__TAURI_INTERNALS__` feature detect）
    - `startEdit/cancelEdit/saveEdit` handlers，Save 调 `invoke("write_text_file", ...)`
    - 工具条 `Show when={!editing()} fallback={...}`：Edit / Save(`*` dirty 指示) / Cancel
    - `Switch` 加 `<Match when={editing() && state()?.loaded}>` 渲染 `<CodeMirrorView>`
    - `createEffect on path` 切 tab 自动退出 editing
  - `packages/app/package.json` 加 CodeMirror 6 一组 + `@tauri-apps/api`。
  - **静态验证全过**：`bun --cwd packages/app run typecheck`（tsgo -b exit 0）+ `cargo check`（59s，0 errors，5 个 upstream 既有 unused warnings）。
  - Windows symlink workaround：`packages/app/src/custom-elements.d.ts`、`packages/enterprise/src/custom-elements.d.ts` 在 Windows clone 时是"存 target 路径的文本"。用 `cp` 覆盖成 ui 原内容 + `git update-index --assume-unchanged` 让 local 通过但不 commit。
  - fork commit `bb3febb68`（Phase 2 静态验证版，`--no-verify` + `[override-blacklist]` + `[large-diff]` override tags，改动日志 #2 全文记载）+ tag `phase-2-editable-file-viewer-static-ok`。
  - push gitee origin/feat/editable-file-viewer（首次遭遇 pre-push hook：PATH 无 bun + `packages/enterprise/src/custom-elements.d.ts` 也是 Windows symlink → 逐个修后通过）。
  - **Runtime 验证（随 Phase 4 tauri build --debug 一并验）**：user 双击启动 OpenCode.exe → 打开文件 → 点 Edit → 改字 → Save → "完全可用,没有发现问题"。L1-L3 + L6 运行时通过。
  - fork commit `cb5460321`（改动日志 #3，runtime 验证记录，**首次通过 pre-commit hook 三项检查，无 --no-verify**）+ tag `mvp-v1-runtime-ok`。
  - push gitee + tag push。

- **2026-04-25** — 文件查看器二轮收口:.md 渲染预览 + 右键"添加到聊天" + 编辑入口迁移到右键菜单。
  - **起因**:朋友试用 MVP v1.2 反馈 .md 文件预览全是源码(表格/任务列表全文本)。深查发现 opencode 上游从未对 .md 跑过 markdown 解析,仓内已有的 `<Markdown>` 组件(marked v17 + shiki + katex + DOMPurify,自带复制按钮 + 缓存)只用在 session 聊天消息渲染,**这次接通它到文件查看器**。一并按用户增量诉求把右键交互重构。
  - **改动文件**:仅 `packages/app/src/pages/session/file-tabs.tsx`(+321/-70)。无新增 npm 依赖、无 Rust 改动。
  - **新增能力**:
    - .md 读模式渲染为 HTML — 零额外配置带出 GFM 表格 / 任务列表 / 删除线 / 代码块 Shiki 高亮 + 复制按钮 / 数学公式 / 内嵌 HTML(div/span/details/svg/纯 HTML 表格等)/ XSS 过滤(DOMPurify 拦 script/style/iframe)
    - **右键自定义菜单**(任意文件类型,不仅 .md):「添加到聊天窗口」(无选区灰)/「编辑」(不可编辑灰 + tooltip 给原因) / 分割线 /「复制 Ctrl+C」(无选区灰);取代 Chromium webview 的原生菜单(返回/刷新/打印/另存为等,文件查看器场景几乎不用)
    - **「添加到聊天窗口」交互**:右键 → 弹菜单 → 点该项 → 切到输入面板(textarea autofocus) → 用户输入"想怎么改/想问什么" → Ctrl+Enter 提交 → 选中文字进 prompt context.preview,用户问题进 context.comment,带 `commentOrigin: "file"` 让点条目跳回文件 tab 而非「审查」tab,带 `commentID: uuid` 兜底去重(避免 0/0 selection 被 dedup 静默吞掉)
    - **顶部 Edit 栏目条移除**;编辑态显示悬浮栏(浅卡片底色 + 阴影),左「保存」(dirty 时显示「保存 *」+ disable 切换)、右「关闭」,两者都退出编辑模式;编辑态右键不拦截,留给浏览器原生菜单(撤销/复制/粘贴)
  - **技术细节**:
    - **CSS Custom Highlight API** 持久化选区视觉 — textarea focus 后浏览器会 collapse window.getSelection,自定义 `::highlight(md-quote-active)` 单独画一层背景色,关闭面板才清除
    - textarea 用 `ref={el => queueMicrotask(() => el.focus())}` 显式聚焦 — Portal+Switch 切换下 HTML 原生 `autofocus` 不可靠
    - `findLineRange` 启发式 — 精确 `indexOf` 失败时归一化空白后再匹配(应对表格跨单元格选中、列表跨项选中等 DOM text 与源码格式不一致),仍失败传 `selection: undefined` 让 prompt context 走"整个文件"分支
    - 浮动菜单用 `Portal mount={document.body}` — 避免被 `<Tabs.Content>` 祖先的 transform/contain 影响 fixed 定位
  - **静态验证**:`bun run typecheck`(0 error)+ `cargo check`(无新 warning,5 个上游既有 dead-code warning 不涉及本改动)
  - **Runtime 验证**:release 构建(1m 12s)→ user 双击 OpenCode.exe → R1-R12 全过(.md 表格 / 任务列表 / 代码块 / 删除线 / KaTeX / `<details>` / 选区高亮持久 / 输入面板自动聚焦 / 编辑入口灰显逻辑 / 悬浮栏保存关闭 / 上下文跳回文件 tab / XSS 过滤)
  - **debug 构建踩坑挂账**:`tauri build --debug` 触发 `lib.rs:306` 的 `#[cfg(debug_assertions)]` `export_types`,specta_typescript 默认 `BigIntForbidden` 对 `get_file_mtime` 的 u64 返回类型 panic。release 不跑这步无影响,挂账修复:`Typescript::default().bigint(BigIntExportBehavior::Number)`。本次 release 路径绕开
  - fork commit `14f8a7992`(改动日志 #7,**走 hook 自带 `--no-verify + [large-diff]` escape**,单文件 391 行渲染分支接通 + 右键交互重构 + 编辑入口迁移三件强耦合,拆 commit 中间态难看;改动日志 entry ~80 行带 R1-R12 回归矩阵 + override 理由 + 已知遗留)
  - push origin(双 push 写 gitee + github)— pre-push hook 跑 13 packages turbo typecheck 全过(521ms,11 个 cache hit + 2 个新跑:app + desktop)
  - **不打新 tag、不归档 artifacts**:朋友未验证此版,沿用 MVP v1.2 作分发版;若反馈正向再打 `mvp-v1.3-md-render`
  - **遗留挂账**(plan 已记):frontmatter YAML 头渲染成 `<hr>` / 相对路径图片不解析 / Mermaid PlantUML 不渲染 / debug 构建 BigInt panic / 行评论在 .md 渲染态失效(用户已接受,改用右键加聊天替代)

- **2026-04-25** — 文件查看器三轮:**内联音频/视频预览 + 系统播放器兜底**(#8)。
  - **起因**:朋友试用反馈打开 `.m4a` / `.wav` / `.mp4` 显示"音频不可预览"。深查发现 server `packages/opencode/src/file/index.ts:536` 对 binary 扩展直接返 `content: ""`,前端从未拿到字节;`packages/ui/src/components/file-media.tsx:217` 的 `<audio>` 模板永远 src 空走 fallback。
  - **改动文件**(4 个 src + Cargo + 改动日志):
    - `packages/desktop/src-tauri/Cargo.toml` 加 `base64 = "0.22"` dep
    - `packages/desktop/src-tauri/src/text_file.rs` 加 `read_binary_file_base64(root, path) -> Result<String, String>`,500MB 阈值
    - `packages/desktop/src-tauri/src/lib.rs:393` collect_commands 注册新 command
    - `packages/app/src/pages/session/file-tabs.tsx` +221 行:AUDIO/VIDEO MIME map + mediaKindFromPath + UNSUPPORTED_MEDIA_EXTS + mediaInput memo + mediaState signal + base64ToBlob + createEffect 异步加载 + race 防护 + onCleanup revoke + onMediaError handler + renderMedia(audio/video Switch + Match)+ openMediaInSystemPlayer + renderFile 路由
  - **新增能力**:
    - 内联播放 audio:`.mp3` / `.wav` / `.ogg` / `.flac` / `.opus` / `.aac`
    - 内联播放 video(带画面):`.mp4` / `.mov` / `.webm` / `.mkv` / `.avi` / `.m4v`
    - `.m4a` 跳过加载直接显示提示 + 系统播放器按钮(WebView2 codec 限制实测无解,所有元素 + mime 组合都试过)
    - 全部媒体类型下方都有"用系统播放器打开"兜底按钮(调 fork 已注册的 `open_path` command,Windows 走系统默认应用)
  - **踩坑迭代过程**(供后续 review):
    - **第 1 版**:用 `state.content.content` 作 dataURL 源 → 永远空(server 对 binary 返 "")
    - **第 2 版**:加 Tauri command + dataURL → 269MB .m4a 触发 100MB 阈值 panic + createResource fetcher 抛错让 SolidJS 整屏 Suspense fallback 闪一下
    - **第 3 版**:换 `createSignal+createEffect`(避开 Suspense)+ Blob URL 替代 dataURL(audio/video 元素 seek/decode 更稳)+ 阈值放 500MB + try/catch fetcher 不抛
    - **第 4 版**:试 m4a 借 `<video>` 元素绕开 `<audio>` codec 限制 → 仍 silent fail(WebView2 全无解码权限)
    - **终版**:`.m4a` 加进 UNSUPPORTED_MEDIA_EXTS,detect 后跳过加载,瞬出提示 + 兜底按钮
  - **技术细节**:
    - **Blob URL 不是 dataURL**:audio/video 元素 seek/decode 走 binary 路径,大文件不卡 string 拼接(269MB 文件 dataURL 是 ~360MB string,Blob 是 269MB binary)
    - **race 防护**:切 tab 太快时旧 invoke 迟到 → 检查 `mediaInput()?.path` 仍是发请求时 path 才 set state
    - **MediaError code 1-4 映射**:`onMediaError` 把 ABORTED/NETWORK/DECODE/SRC_NOT_SUPPORTED 写进可读错误,用户界面直接看(不用开 devtools)
    - **多 mime fallback `<source>` 列表**:让 chromium 自挑第一个识别的 type(应对 m4a 的 audio/mp4 vs audio/x-m4a vs audio/aac 识别差异)
  - **静态验证**:typecheck + cargo check 全过(base64 dep 加载成功,0 error,5 个上游既有 dead-code warning)
  - **Runtime 验证**:release 构建(~1m 15s 增量)→ user 双击 OpenCode.exe → R1-R7 全过(.mp3/.wav 内联 / .m4a 秒出提示+按钮 / .mp4 视频带画面 / 系统播放器按钮 / 切 tab 无残留无闪屏 / 元素右键 / 大文件错误降级)
  - fork commit `f33618d91`(改动日志 #8 ~110 行,**走 hook 自带 `--no-verify + [large-diff]` escape**,跨 4 文件 + Cargo + 改动日志共 350 行 staged diff;Rust command + TS 调用 + 渲染 + 兜底按钮逻辑紧密耦合,拆 commit 中间态无法验证)
  - push origin(双 push gitee + github)— pre-push hook 13 packages turbo typecheck 全过(321ms,12 cache hit + 1 个新跑)
  - **不打新 tag**:沿用 #7 同分支线;若朋友反馈正向把 #7 + #8 一起固化为 `mvp-v1.3-md+media` tag
  - **遗留挂账**:`.m4a` 内联放不了(WebView2 + Chromium codec 限制不可控,只能等 WebView2 evergreen 加 codec license / ALAC 支持永远不会有)/ ALAC 编码音频同样问题(系统播放器兜底)/ 大文件(>500MB)拒绝加载也走兜底 / debug 构建 BigInt panic 仍未修(#7 提到的 latent bug)

- **2026-04-25** — 文件查看器四轮:**office 文档预览 + 安装引导**(#9)。
  - **起因**:user 提需求"调研下文件查看器要解析展示 word ppt excel pdf 应该怎么做"。深查发现 opencode server `packages/opencode/src/file/index.ts` 把 `pdf/doc/docx/xls/xlsx/ppt/pptx` 全部当 binary,前端 FileMedia 落 "Binary file" 占位符。
  - **新增能力**:统一管线 — 后端调 LibreOffice 把 office 转 PDF + 磁盘缓存(SHA256(path+mtime+size)),前端 pdfjs + TextLayer 渲染(版式 100% 保真,文字可选可复制可搜索);LibreOffice 未装时弹 onboarding,5 镜像 Promise.any 测速 + msiexec /qn ALLUSERS=2 MSIINSTALLPERUSER=1 静默安装不弹 UAC;office-pdf 走二进制端点不走 base64 + JSON(300MB PPTX 内存峰值从 1.5GB 降到 ~600MB);LRU(2) ArrayBuffer 缓存切回秒开;office 文件右键"编辑"按钮 disabled
  - **改动文件**(8 src + Cargo + 改动日志):后端 `index.ts` / `libreoffice.ts` / `office-installer.ts` / `routes/instance/file.ts` + SDK 重生成 + 前端 `pierre/media.ts` / `file-media.tsx` / `document-viewer/{index,pdf}.tsx` / `office-install-prompt.tsx` + app `file-tabs.tsx` / `utils/file-limits.ts`
  - **依赖**:`pdfjs-dist` (Apache-2.0)+ 运行时按需 LibreOffice (MPL 2.0) ~355MB,onboarding 引导
  - **静态验证**:typecheck + cargo check 全过
  - **Runtime 验证**:release 构建 → user 双击 OpenCode.exe → R1-R10 全过(LibreOffice 未装弹 onboarding / 国内镜像 < 1s 命中 / 30 秒下完 / 静默安装 30-60 秒 / docx + xlsx + pptx + odt 内联预览 / 文字可选可复制 / 大 PDF 不 OOM / 切 tab 秒开 / 系统播放器兜底按钮 / 编辑入口灰)
  - fork commit `66c8fa523`(改动日志 #9 ~190 行,**`--no-verify + [large-diff] + [override-blacklist]` 三 override**,~1700 行 staged diff;协议 + 路由 + UI 必须一起上才能跑通)
  - push origin(双 push gitee + github)
  - **不打新 tag**:沿用 #7 + #8 同分支线;若朋友反馈正向再固化
  - **遗留挂账**:LibreOffice 跨文件不复用进程(每新 office 文件冷启动 1-3s,UNO bridge 工程量大未做)/ macOS / Linux 没自动安装(手动配 OPENCODE_SOFFICE)/ 编辑能力没有(只读预览,有"改用本机软件打开"按钮)

- **2026-04-25** — 文件树右键菜单 — **完整文件操作**(#10)。
  - **起因**:user 提需求"文件目录区域右键菜单加'在文件夹中显示'"。落地后 user 反馈右键替换掉了 Chromium 原生菜单(返回/刷新/另存为/打印/更多工具),要求保留 + 加一项。说明 **WebView2 不支持往原生菜单注入条目**(微软限制,不是 Tauri),user 改方向重新规划成完整 7 项菜单;后续多轮调整 — 行菜单 vs 空白区菜单分离 → 行菜单也要新建(目标按行类型不同) → 文件夹打印 disabled → 顺序定型。一并加了"创建新文件不刷新"的诊断 console.debug(B-1),根因高置信(Windows 反斜杠),实际修(B-2)留下次会话验证后做。
  - **新增能力**:
    - **行菜单**(file / folder)7 项:重命名 / 在文件夹中显示 / 打印(folder disabled)/ ── / 删除(走系统回收站,可恢复)/ ── / 新建文件 (.md) / 新建文件夹
    - **空白区菜单**(包括底部空白)3 项:新建文件 / 新建文件夹 / ── / 刷新
    - 新建目标按行类型自动选:file → 同级目录,folder → 内部(自动展开),空白区 → workspace 根
    - **右键打开菜单时被点行高亮选中态**(复用 `bg-surface-base-active`)
    - 名称含 `/` `\` 拒绝 + 已存在同名 toast
  - **改动文件**(3 src + Cargo + 1 新文件 + 改动日志):
    - `packages/desktop/src-tauri/Cargo.toml`(+1 行 `trash = "5"`)
    - `packages/desktop/src-tauri/src/lib.rs`(+52 行 5 个新 `#[tauri::command]`:reveal_in_folder / create_directory / create_empty_file / rename_path / trash_path,注册到 collect_commands!)
    - `packages/app/src/components/file-tree.tsx`(+380 行,ContextMenu 包行 + 包外层空白区 + per-row 选中 signal + Dialog 触发 + helper)
    - `packages/app/src/components/dialog-file-tree.tsx`(新 ~125 行,DialogFileTreePrompt + DialogFileTreeConfirm 通用组件)
    - `packages/app/src/context/file/watcher.ts`(+2 行 `console.debug` 诊断 B 部分)
  - **依赖**:`trash` crate(Apache-2.0 / MIT,跨平台 Windows Recycle Bin / macOS Trash / Linux trash spec)
  - **踩坑迭代**(供后续 review):
    - v0 一开始把"在文件夹中显示"做成单项 → 替换掉 Chromium 原生菜单 → user 反馈
    - v1 行 vs 空白区菜单拆分 → 外层 `<div data-component="filetree">` 在 level === 0 包 ContextMenu(空白区)
    - v2 底部空白区右键不响应 → outer 加 `min-h-full` 撑到父容器
    - v3 选中态丢失 → 给 FileTreeNode 加 `contextOpen` prop,classList OR 关系避免和 active tab 高亮覆盖
    - v4 user 反馈行菜单也要新建(target 按 file / folder 不同)
    - v5 user 给最终顺序 + folder 时打印 disabled
    - v6 build 卡 SignTool → 改用 `--no-bundle` 跳过 NSIS
    - v7 build 卡"failed to rename app binary OS error 5" → 旧 OpenCode.exe 在跑锁文件 → Stop-Process + 增量 build
    - v8 watcher.ts 留诊断不立即删 → user 没测过 B 之前留着,B-2 修复时一并删
  - **静态验证**:typecheck + cargo check 全过(只有原本 dead_code warning)
  - **Runtime 验证**:release 构建(`tauri build --no-bundle` ~1m 12s 增量)→ user 双击 OpenCode.exe → R1-R11 全过(行菜单 7 项 / folder 打印灰 / 空白区 3 项 / 选中态高亮 / 新建目标按行类型 / 删除进回收站 / 重命名 / 在文件夹中显示 / 左键打开 + 展开折叠 / 名称校验)
  - fork commit `<本次>`(改动日志 #10 ~120 行,**`[large-diff]` override**,~480 行 staged diff;5 Rust 命令 + Dialog 组件 + 菜单 7 项接线最小可独立验证单元。**未触动黑名单文件**,不需 `[override-blacklist]`)
  - push origin:**未 push**,等 user 拍板
  - **不打新 tag**:沿用前面分支线;若朋友反馈正向把 #9 + #10 一起固化为 `mvp-v1.4-file-ops` tag
  - **遗留挂账**:
    - **B 部分**(Windows 反斜杠导致 SSE watcher 不刷新)只加诊断 console.debug,实际修(`watcher.ts:27` 加 `.replace(/\\/g, "/")` + 删调试)留下次会话(待 user 测一遍贴日志确认根因)
    - 文件夹无"在此文件夹内单独刷新"快捷项(只能在该文件夹的"新建"动作后被动 refresh,或退到空白区"刷新"全树)
    - 菜单文案硬编码中文,无 i18n key
    - 重命名 / 删除已打开 tab 的文件,tab 内容会变 stale(mtime 冲突保护仍在,save 时被拒)
  - **plan 文档**:`D:\project\OPENCODE-PLAN\规划\11-文件树右键-在文件夹中显示.md`(本会话初版规划)— 实际落地比规划广得多,后续应改为现状文档反映最终菜单结构

- **2026-04-26** — 文件查看器 — **py/html/code 文件加入聊天后选区不消失**(#11,**#7 的 follow-up**)。
  - **起因**:user 反馈 .py / .html 等文件查看器选中文字 → 右键 → "添加到聊天窗口" → 选中视觉消失;.md 文件同操作高亮持续显示。要求统一行为。
  - **根因**:#7 用 `::highlight(md-quote-active)` (CSS Custom Highlight API) 持久化选区。.md 渲染在 light DOM,onMount 注入 `document.head` 的 `<style>` 规则直接生效;非 md 文件走 `@pierre/diffs` 的 `<diffs-container>` **shadow DOM**,HighlightRegistry(`window.CSS.highlights`)是 document 全局,但 `::highlight()` 样式规则是 **per-tree**,light DOM 的 style 不会渗到 shadow root → Highlight 注册了但画不出来。
  - **第一次尝试失败**:用 `event.target.getRootNode()` 找 shadow root → 浏览器 retargeting 把 event.target 改成 shadow host (`<diffs-container>`),拿不到真 ShadowRoot。改红色颜色排查后 user 验证仍完全没红色 → 确认 shadow 路径根本没打通。
  - **终版方案**:`event.composedPath()` 找真实 ShadowRoot;`shadowRoot.getSelection()` 取 shadow-tree-internal 的细粒度 Range(`window.getSelection()` 给的是投影到 host 的粗粒度 Range,Highlight 落在 host 上不绘制);`adoptedStyleSheets` 把 `::highlight` CSS adopt 进 shadow root(比 `<style>` 元素更稳,不会被 Pierre 内部 mutation observer 清掉);颜色由 35% 黄改 50% 红 — Pierre code viewer 行级活动区(`selectedLines={activeSelection()}`)已是满黄底,叠 35% 黄看不出,红色对白底(.md)和黄底(code)都清晰。
  - **改动文件**:仅 `packages/app/src/pages/session/file-tabs.tsx`(+51/-8,共 59 行 staged diff)。无新依赖、无 Rust 改动、无新文件。
  - **覆盖范围**:.py / .html / .ts / .tsx / .js / .json / .yaml / .toml / .css / .go / .rs / .java / .c / .cpp / .sh / .xml / .sql / .txt 等所有非 md 非 audio/video 文本/代码格式 — 一处改动全覆盖。
  - **静态验证**:`bun run typecheck` 0 error
  - **Runtime 验证**:release `bun run tauri build` → core exe `packages/desktop/src-tauri/target/release/OpenCode.exe` 已产出 → user 双击验过 R1-R3(.py 选中红色保持 ✅ / .md 红色保持(替原黄)✅ / 关闭/提交后高亮消失 ✅)
  - fork commit `caf92d555`(改动日志 #11,~60 行单文件,**无 override**)
  - push origin(双 push gitee + github)— `git ls-remote --heads` 验证两端 head 都对上 `caf92d555` ✅
  - **不打新 tag**:沿用 #7 / #8 / #9 / #10 同分支线
  - **遗留挂账**:
    - Tauri build NSIS bundler SignTool 报错(这台机器未装 Windows SDK 签名工具),core exe 仍正常产出,本地验证不受阻;user 决定"先不管,以后要发给其他人时再处理签名"
    - .md 高亮颜色由黄变红是全局变化,#7 的 .md 行为外观一并变化(user 已确认接受)

---

## Phase 3 — 保存 + 冲突处理 ✅(核心 4 项;拦截 2 项挂账)

### 目标

写文件 + mtime 冲突检测 + 防呆（二进制 / 大文件 / readonly）+ dirty 拦截。

### 步骤

- [x] Rust `write_text_file` command（`std::fs::write` 同步版足够） ✅
- [x] 前端 save handler：成功 `setEditing(false)` + `file.load({ force: true })` ✅
- [x] 加载时记录 mtime（startEdit 调 `get_file_mtime`） ✅
- [x] 保存前对比 mtime，不一致 → `window.confirm("覆盖 / 放弃重载")` ✅
- [x] Readonly 检测（Rust `permissions().readonly()` → 专用 `readonly:` err → 前端专用 toast） ✅
- [x] 二进制文件禁用 Edit（`file-limits.ts` 32 扩展名 blacklist） ✅
- [x] 大文件（>10MB）禁用 Edit（JS string 长度判断） ✅
- [x] Edit 按钮 hover 提示禁用原因（`editDisabledReason()`） ✅
- [ ] dirty 切 tab 拦截 — 🟡 挂账（改 opencode reactive 系统太深）
- [ ] 关窗口拦截 — 🟡 挂账（要改 app entry / Tauri window close 事件）

### mtime 冲突的决策矩阵（10 种场景）

| 场景 | 查看器 | 记事本 | 处理 |
|---|---|---|---|
| 1A | 纯 view | 改+存 | opencode SSE 自动 reload ✅ |
| 2A | editing 未改 | 改+存 | watcher 更新 contents；后续 Save 走 3C ⚠️ |
| 3A | editing+dirty | 无 | Save 成功 ✅ |
| **3B** | editing+dirty | 改，**未存** | Save 成功；记事本内存丢 ⚠️ **物理无法检测** |
| **3C** | editing+dirty | 改+存 | **弹 confirm 覆盖/放弃** ✅ **核心保护** |
| 3D | editing+dirty | 改+存+改回+存 | 弹 confirm（false-positive）⚠️ 扰人但安全 |
| 5A | editing+dirty | 删除 | metadata 失败跳过检测，write 重新创建 ✅ |
| 5B | editing+dirty | rename/move | 原 path 重新创建（不跟随）⚠️ 挂账 |

**实现方案对比**：A 事后 confirm（已选）vs B 提前感知（订阅 opencode SSE watcher）；B 依赖 opencode 未对外暴露的 listener，~100+ 行成本超预算；A 已守住"数据不丢"底线，待朋友真实反馈驱动是否加 B。

### Blocker

_（无，Phase 3 核心 4 项已完成）_

### 本日更新日志

- **2026-04-24** — Phase 3 完整实施（~3 小时单次 session）。
  - Rust `text_file.rs` 从 5 行扩展到 56 行：新增 `get_file_mtime` 命令，`write_text_file` 签名扩展为 `(root, path, content, expected_mtime: Option<u64>) -> Result<u64>`，内置 readonly + mtime 检测
  - `lib.rs:391` collect_commands 加 `text_file::get_file_mtime`
  - `packages/app/src/utils/file-limits.ts` 新增 45 行（`isBinary` 32 扩展名 / `tooLarge` 10MB）
  - `file-tabs.tsx` 扩展：`loadedMtime` signal + `startEdit` async 读 mtime + `saveEdit` 带 expected_mtime + 捕获 `mtime_conflict` 弹 confirm + 捕获 `readonly` 专用 toast + `canEdit` 集成 binary/大文件检查 + `editDisabledReason` 按原因返回提示
  - 静态：typecheck ✅ + `cargo check` ✅（59s，0 errors）。期间一次 false start（`variant: "info"` 不在 ToastVariant 里，改 `"success"`）
  - Release build `tauri build --no-bundle` 2m19s 产出新 `OpenCode.exe`，artifacts 刷 `D:\artifacts\opencode-mvp-v1-release\`
  - **User 亲验 5 项全过**：① 常规 Save ② 二进制 Edit 按钮 disabled ③ 大文件 disabled ④ readonly toast ⑤ mtime 冲突 confirm 对话框 + 覆盖/放弃路径
  - fork commit `4097f6830` + tag `mvp-v1.2-save-safety`（`--no-verify` + `[large-diff]` override，总 ~260 行含改动日志 #6 约 90 行）
  - 双 remote push 成功（gitee + github）

---

## Phase 4 — 小范围分发打包 🟡 debug exe 就绪，NSIS bundler 挂账

### 目标

`tauri build` 产出 `.exe`，让小范围朋友 / 同事 / 内部团队能装能用。

### 步骤

- [x] `bun run tauri build --debug` 产出 `OpenCode.exe`（41 MB）+ `opencode-cli.exe`（152 MB sidecar）在 `target/debug/` ✅
- [ ] `tauri build`（release profile）产出 NSIS `.exe` — **挂账**：bundler 调 SignTool 缺失，build.rs 阶段报 `SignTool not found`。MVP 阶段分发双 exe（OpenCode.exe + opencode-cli.exe）就够用，安装器 later
- [ ] 自签名（可选）：`New-SelfSignedCertificate` + `Set-AuthenticodeSignature` — 挂账
- [ ] 写「小范围用户安装说明」（双 exe 解压同目录、WebView2 检查、SmartScreen "仍要运行"步骤）— 挂账
- [x] 本地 artifacts 归档：`D:\artifacts\opencode-mvp-v1\{OpenCode.exe, opencode-cli.exe}` ✅
- [ ] 发布渠道：GitHub Release（fork 仓库）/ 微信群 / 阿里云盘 — 待用户决定

### 明确不做的事（小范围豁免）

- 🚫 EV 代码签名证书（¥3000-8000/年）
- 🚫 自动更新 server
- 🚫 CDN 托管
- 🚫 品牌替换（小范围内部豁免，公开分享再议）

### Blocker

- **SignTool 不在 PATH**（Windows SDK 的 signtool.exe）→ 仅阻塞 NSIS bundler，不阻塞 exe 本身
- **sidecar target 硬编码 `-baseline` flavor**（`packages/desktop/scripts/utils.ts`）但 bun 1.3.13 下 `bun-windows-x64-baseline-v1.3.13` tarball extract 失败，挡住 `bun run build --single --baseline`。MVP 路径绕开：用 non-baseline build 产出的 `opencode-windows-x64/bin/opencode.exe` 手动 copy 到 sidecar 位置。需 CPU 支持 AVX2（Win11 机器几乎都支持）

### 本日更新日志

- **2026-04-24** — Phase 4 首次 debug build 跑通，user 端到端验证 MVP 可用。
  - `bun run tauri build --debug` 完整链路：beforeBuildCommand（typecheck 15s + vite build）+ cargo build 6m53s（debug profile 首次）+ bundler。Bundler 阶段 `SignTool not found` 失败但 **exe 已在 cargo link 阶段 built**：`D:\project\opencode-fork\packages\desktop\src-tauri\target\debug\OpenCode.exe`。
  - Sidecar 问题：先手动 `cp packages/opencode/dist/opencode-windows-x64/bin/opencode.exe packages/desktop/src-tauri/sidecars/opencode-cli-x86_64-pc-windows-msvc.exe`（因 baseline flavor 无法构建），tauri build 自动 copy 到 `target/debug/opencode-cli.exe` 可被 runtime 加载。
  - User 双击 OpenCode.exe → 主窗口出现、session 可用 → 打开文件、点 Edit、改字、Save → 全链路通，user 反馈 **"完全可用,没有发现问题"**。
  - Artifacts 归档到 `D:\artifacts\opencode-mvp-v1\`。
  - fork 改动日志 #3 / commit `cb5460321` / tag `mvp-v1-runtime-ok` / 推 gitee。

---

## Phase 5 — 长期维护（未进入）

### 固定节奏

- 每 2-4 周 `git fetch upstream dev && git rebase upstream/dev`
- 每次官方更新后重新打包发群
- 观察 Issue 01 是否被官方合入 → 合入则宣布停止维护 fork

### 风险信号

- 连续 3 次 rebase 都有大量 conflict → 评估是否重做改动
- `@pierre/diffs` 升级导致自己改动失效 → 评估 Plan B

---

## 跨 Phase 的风险看板

| 风险 | 严重度 | 触发 Phase | 应对 / 当前状态 |
|---|---|---|---|
| ~~`@pierre/diffs` 拉不到~~ | 🔴 → ✅ | Phase 1 | **已解除**（2026-04-24）：该包是 Apache-2.0 开源 npm 包 |
| ~~SolidJS × CodeMirror 响应式冲突~~ | 🟡 → ✅ | Phase 0 / 2 | Phase 0 prototype 无冲突 |
| Windows IME 在 WebView2 下异常 | 🟡 | Phase 0 / runtime | 未显式验；MVP 现有用法未触发（非 i18n 频繁输入场景），挂账到实际出现 |
| 官方 upstream 架构大改 | 🟡 | Phase 5 | 每月 rebase 时评估，必要时定版 |
| ~~sst 对 Issue 01 明确拒绝~~ | 🟢 → 🚫 | Pre-4 | 轨道 1 暂搁，不阻塞 |
| `bun compile` baseline flavor 失败 | 🟡 | Phase 4 bundler | **已 workaround**：用 non-baseline sidecar；朋友圈受众 CPU 都支持 AVX2，风险低 |
| SignTool missing → NSIS bundler 挂 | 🟢 | Phase 4 | **不阻塞 MVP**：裸 exe 直接分发；等有朋友要 installer 再补 |
| Windows git clone 不解析 symlink | 🟡 | 开发环境 | **已 workaround**：`cp` + `git update-index --assume-unchanged`；考虑写进 fork README 给未来克隆的人 |

---

## 近期更新时间轴

- **2026-04-23** — 规划文档就位；Issue 素材（01 + 02）成稿；项目目录整理完成（01-08 归档到 `规划/`，新增本文档）。
- **2026-04-23（晚）** — 决定方案 B：prototype 进本仓库 `prototype/` 子目录，Linux 开发，目标 Win + Mac，CI 兜底。建好骨架（`prototype/{README,改动日志,src,src-tauri/...}`）+ `.gitignore`（fork 整个排除）+ `./governance/改动规则.md`（7 道护栏 + AI 操作内化护栏）。打 baseline tag `pre-prototype-setup-2026-04-23`。下一步：用户决定 Phase 0 是立刻 `bun create solid` 还是先发 Issue。
- **2026-04-23（深夜）** — Phase 1 启动：clone sst/opencode 到 `~/projects/opencode-fork/`，gitee 主仓 `zoulukuang/opencode-for-office` 已建好接收；fork bootstrap 提交 `623579217` 推到 gitee dev（含 `.gitattributes`/`.husky/pre-commit`/`scripts/install-hooks.sh`/`改动日志.md`）。opencode-plan 同步加 `.gitattributes`/`.editorconfig`/`./governance/跨平台协作.md`；09 文档基于真实 packages 结构（20 个）重写白名单 + 加第 8 道护栏（大小写检查）。两个仓库的跨平台基础设施齐备。
- **2026-04-24** — **MVP v1 达成日**。路线重大调整：① 放弃 Linux 开发，全程 Windows 本机 ② 轨道 1（向 sst 提 Issue / PR）暂搁，只做轨道 2。单日完成：Windows 装齐环境（bun + Rust + MSVC + WebView2 都到 D 盘）→ 清 C 盘（Temp + npm-cache 释放空间）→ 改 TEMP 目录到 D:\tmp\windows-temp → fork clone 到 D 盘 → `bun install` 解除 `@pierre/diffs` 风险 → Phase 0 prototype 端到端通（tag `proto-l-all-pass`）→ Phase 2 核心改动（`bb3febb68`, tag `phase-2-editable-file-viewer-static-ok`）→ Phase 4 `tauri build --debug` 产出可跑 exe → user 亲验"完全可用" → Phase 2/4 验收 commit（`cb5460321`, tag `mvp-v1-runtime-ok`）→ artifacts 归档 `D:\artifacts\opencode-mvp-v1\`。**从启动到端到端 runtime 通过用时 2 个日历日**（原 MVP 估算 6-12 天）。
- **2026-04-24（MVP 后同日）** — **MVP v1.1 → v1.2 连续两轮改进**：① user 发现 Save 相对路径 bug（opencode 的 `pathFromTab` 返回相对 workspace root）+ Save 后 UI 不 reload 两个 bug → `42aea0234` + tag `mvp-v1.1-savefix`；② 拆分 debug/release build 概念 — debug 带黑 console（`windows_subsystem = "windows"` 仅 release 生效），跑 `tauri build --no-bundle` 产 release 版 `OpenCode.exe` 25 MB 无 console；③ 关联 github fork `yuesoue/opencode-for-office` + gitee 仓库改名 `opencode-for-office` + C 方案双主仓 origin 双 push；④ **Phase 3 Save 安全护栏**：mtime 冲突检测 + readonly + 二进制禁用 + 大文件禁用 → `4097f6830` + tag `mvp-v1.2-save-safety`。当前分发版本 = `mvp-v1.2-save-safety`。
