---
feat-id: macos-右键选区-修复
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# macos-右键选区-修复 — plan

## 实施步骤

### 1. `packages/app/src/pages/session/file-tabs.tsx` 选区捕获改造

- 加 `selectionHistory: SelSnapshot[]`(限 16),`selectionchange` 持续记录所有非空选区(`{ text, range, shadow, time }`)
- 加 `pickBestRecentSelection()`:从最近 30 秒里挑 `text.length` 最长的快照
- `handleSelectionContextMenu` 主路径改成读 history 最长,fallback 才读当前 selection
- 保留 `readSelectionText()` 三策略级联:`getComposedRanges({ shadowRoots })` → `ShadowRoot.getSelection()` → `window.getSelection()`
- 保留 `handlePreContextCapture` 双通道收 Shadow Root(`composedPath` + DOM 查询)

### 2. 同文件 视觉高亮改 overlay div

- 加 `[highlightRects, setHighlightRects]` Solid 信号(`HighlightRect[] | null`)
- `setSelectionHighlight(range)` 改为:`range.getClientRects()` → 过滤掉 width/height = 0 的 → 转纯对象数组 → 写信号
- `setSelectionHighlight(null)` 直接 `setHighlightRects(null)`
- 加 `createEffect` 在 highlightRects 非空时绑 `window.scroll` capture listener,触发就清(rect 失效)
- 在 ScrollView 之后、menu Portal 之前加 `<Show when={highlightRects()}>` + `<For each={...}>` 渲染 fixed div 数组(`background-color: rgba(209, 52, 56, 0.5)`,Fluent 红 0.5 alpha)
- 删除 `HIGHLIGHT_CSS` / `getHighlightSheet` / `ensureHighlightStyleIn` / `setSelectionHighlight` 旧 CSS Custom Highlight 整套

### 3. 同文件 关闭菜单统一清理

- `closeMdMenu()` 加三步:`setSelectionHighlight(null)` / `window.getSelection()?.removeAllRanges()` / `setNote("selected", null)` + `file.setSelectedLines(p, null)`
- `submitMdSelection` 末尾原本有的 `removeAllRanges()` 调用删除(`closeMdMenu` 已统一处理,避免重复)

### 4. 单笔 commit

只触动 1 个 fork-only 文件,Medium 级。无 baseline tag 需求,无 override 配额消耗。

## 决策轨迹(四轮迭代)

| 轮次 | 思路 | 失败 / 落地原因 | 结果 |
|---|---|---|---|
| 1 | mousedown capture-phase `preventDefault()` 拦 WebKit collapse | OS 级行为,JS 拦不住 | 失败 |
| 2 | `rightClickActive` flag 屏蔽 `selectionchange` | 时机 A(selectionchange 在 mousedown 之前触发)flag 还没立起来,坏值已经写入缓存 | 失败 |
| 3 | mousedown 时 pop 100ms 内栈顶可疑条目 + 250ms 屏蔽 selectionchange | 用户**刚选完就右键**时,真实选区 < 100ms 新,被 pop 掉 → 栈空 → fallback 读 `window.getSelection()` 拿到 collapse 后单词 | 失败 |
| 4 | **selectionchange 全记录,contextmenu 挑最长** | 不依赖 mousedown 时间锚点,WebKit collapse 出的单词永远比多行选区短,挑最长天然正确 | ✅ 通过 |

| 决策点 | 选项 | 取舍 | 理由 |
|---|---|---|---|
| 选区捕获策略 | A. 屏蔽 collapse 回调(轮 2/3) / B. 全记录后挑最长(轮 4) | B | A 依赖时机锚点,A/B 时机不可控;B 天然规避所有时机问题 |
| 历史栈大小 | 8 / 16 | 16 | 用户拖选过程会触发多次 selectionchange,8 不够;16 实测足够,user 验证 picked.idx=15 |
| 时间窗口 | 5s / 30s | 30s | 用户右键前可能选完看一会儿再操作,30s 留够余量;过长无意义因为更老的选区也不会是当前的菜单需求 |
| 视觉高亮渲染 | A. CSS Custom Highlight / B. overlay div | B | A 在 macOS WKWebView 上 `highlights.delete()` stale 渲染,清不掉;B 信号驱动 unmount 强制 DOM 移除,WebKit 必清 |
| 红色色号 | A. `--surface-warning-strong` 同色系 / B. 独立红色 hex | B | warning 是黄色系,与 Pierre 黄色行底色叠加几乎看不见;红色与黄色对比强且与 Windows 同操作惯例一致 |
| 关闭菜单清理范围 | A. 只清自家 overlay / B. 一并清原生 selection + Pierre 行选区 | B | 用户认知里"取消加入聊天"应回干净态;只清 overlay 但留 Pierre 黄色行底色和原生 selection 视觉残留体验割裂 |

## 风险

- **滚动时 overlay rect 失效**:已绑 scroll capture listener 自动清,菜单生命周期短,概率低
- **多 FileTabContent 实例并存**:`selectionHistory` / `highlightRects` 都是组件内闭包 / 信号,实例隔离,无全局污染
- **30s 历史窗口可能让"很久前的长选区"覆盖"刚选的短选区"**:理论存在,但用户拖完不会等 30s 才右键,实测无此问题。如未来踩坑,可改成"prefer 最新 + 长度过滤"
- **Pierre 上游 0 改动**:本 feat 完全在 fork 白名单(`packages/app/src/pages/session/`),不消耗 override 配额
- **不引入新依赖 / 不动 husky pre-commit / 不动黑名单**:无 R3 三禁令风险

## 预算

| 项 | 行数 |
|---|---|
| `file-tabs.tsx` 净增 | ~225 行 / -66 行 = +159 净 |
| **代码 staged** | **~225 行**(insertions),Medium 级 |
| 文档 fork-only(本目录三件) | ~280 行 |
| **总 staged** | **~500 行**,刚到规范 v2 阈值,符合 Medium 标准 |

无 large-diff 标(>500 才需要 user 审签),无 override 配额消耗。

## 验证脚本

build 走 `bash packages/branding/scripts/build-deskfox.sh -Env dev`(**不带** `--no-bundle`,因为 user 测试链路是 `open .app`,详见 [feedback_no_bundle_pitfall.md](../../../。该 memory 记录在 ~/.claude/projects/-Volumes-ExtSSD-opencode-fork/memory/) 已记入)。产出 `.app` bundle,user 双击打开测 R1-R7。

构建前必杀进程:`pkill -9 -f "DeskFox" 2>/dev/null; pkill -9 -f "opencode-cli" 2>/dev/null`。

## 走过的弯路 / 中途调整

### 设计 / 实施层

- **三轮失败迭代**(详见决策轨迹四轮表):pop+block 思路从根上就错,挑最长才是对的。每一轮失败都让我以为找到根因,实际只解决了部分时机。教训:用户右键 macOS 选区的**真实事件时序**(mousedown JS / selectionchange / contextmenu 之间在 WebKit 上不固定先后)用文档很难推清楚,**早一点上诊断面板**比"凭推理改方案"快得多
- **诊断面板加值巨大**:第三轮挂掉时加了菜单内 [DEBUG] 黄色面板 + "复制调试信息"按钮,user 点一下就贴回来 selectionHistory 全栈 + 最近事件流,定位 bug 立刻清晰
- **CSS Custom Highlight 死路**:第四轮选区捕获通了之后,清除 highlight 又卡 WebKit `highlights.delete()` stale 渲染。试过 collapsed-range 兜底也压不住,最后改 overlay div 才彻底解决。教训:Custom Highlight API 在 macOS WKWebView 上**不能假设 delete 立即生效**,要么用信号驱动的 DOM 渲染,要么接受偶尔 stale

### 操作层

- **`--no-bundle` 不更新 .app 的坑**:连续四轮 `--no-bundle` 重 build,每次让 user `open .app` 测,实际打开的还是最初 20:25 那次完整构建的老版本,白测两轮被 user 骂"什么都搞不定"才发现。已记入 memory(`feedback_no_bundle_pitfall.md`)避免重蹈。**结论**:让 user `open .app` 的链路必须**完整构建**(去掉 `--no-bundle`);只让 user 跑 raw binary `target/release/DeskFox` 时 `--no-bundle` 才行
- **诊断面板临时打开 Tauri `devtools` Cargo feature**:为了 console.log 双保险,定位完成后撤回不留 release 痕迹

### 状态升级

INDEX.md 状态映射本次实际节奏:planning(spec 起草)→ in-progress(轮 1-4 迭代 + 撤诊断)→ done(R1-R7 全过 + 落文档)。
