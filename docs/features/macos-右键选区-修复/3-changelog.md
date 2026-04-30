---
feat-id: macos-右键选区-修复
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# macos-右键选区-修复 — changelog

**关联 commit**: `ed8ac9856`
**所在分支**: `feat/editable-file-viewer`
**baseline tag**: 沿用线(无新 baseline)
**触发原因**: User 报 macOS 桌面端文件查看器选中文字 → 文字上右键 → 选区视觉消失,只剩被点中的词高亮;菜单"添加到聊天窗口"传给模型的也是 collapse 后单词。详见 `1-spec.md` 触发原因段(双层根因:Pierre Shadow DOM 选区 API 限制 + macOS WebKit 右键 OS 级 collapse)。

## 实际改动

### `packages/app/src/pages/session/file-tabs.tsx`(+225 / -66)

#### 选区捕获(R1-R3)

- 加 `selectionHistory: SelSnapshot[]`(限 16 条),`selectionchange` 持续记录所有非空选区
- 加 `pickBestRecentSelection()`:从最近 30 秒内挑 `text.length` 最长的快照(WebKit collapse 出的单词永远比多行选区短)
- `handleSelectionContextMenu` 主路径改成读 history 最长,fallback 才读当前 selection
- `readSelectionText()` 三策略级联:`getComposedRanges({ shadowRoots })` → `ShadowRoot.getSelection()` → `window.getSelection()`(对应 WebKit 17+ / Chromium / light DOM 三套 API)
- `handlePreContextCapture` 双通道收 Shadow Root(`composedPath` + `querySelector("diffs-container")?.shadowRoot`)

#### 视觉高亮 — overlay div(R4-R6)

- 加 `[highlightRects, setHighlightRects]` Solid 信号
- `setSelectionHighlight(range)` 改为 `range.getClientRects()` → 过滤 width/height = 0 → 转纯对象 → 写信号
- ScrollView 之后加 `<Show when={highlightRects()}>` + `<For>` 渲染 `position: fixed` 红色 div(`rgba(209, 52, 56, 0.5)` Microsoft Fluent 红 #d13438 半透明)
- 滚动时绑 capture-phase scroll listener 自动清(viewport rect 会失效)
- 删除旧 CSS Custom Highlight 整套(`HIGHLIGHT_CSS` / `getHighlightSheet` / `ensureHighlightStyleIn` / `::highlight()` pseudo)—— macOS WKWebView 上 `CSS.highlights.delete()` stale 渲染压不住

#### 关闭菜单统一清理(R5)

- `closeMdMenu()` 加三步:
  1. `setSelectionHighlight(null)` 清红色 overlay
  2. `window.getSelection()?.removeAllRanges()` 清原生字符级选区
  3. `setNote("selected", null)` + `file.setSelectedLines(p, null)` 清 Pierre 整行黄色色块
- "加入聊天"提交路径(`submitMdSelection`)末尾原本的 `removeAllRanges()` 删除 — 已在 `closeMdMenu` 统一,避免重复

### 文档(本目录三件 + INDEX)

- `docs/features/macos-右键选区-修复/{1-spec,2-plan,3-changelog}.md`(新建)
- `docs/features/INDEX.md` 加索引行 + status `done`

## 行数

| 项 | 行数 |
|---|---|
| `file-tabs.tsx` insertions | 225 行 |
| `file-tabs.tsx` deletions | 66 行(主要是删 CSS Custom Highlight 整套 + 三轮失败的中间方案残留) |
| **代码 staged 净** | **~225 行 insertions** |
| 文档(新文件,不计阈值) | ~280 行 |

代码 insertions 在规范 v2 的 500 阈值之内,Medium 级。无 large-diff override 标。

## 影响范围

- ✅ `.py` / `.ts` / `.html` / Pierre 渲染的所有代码文件:文字上右键稳定捕获用户多行真实选区
- ✅ `.md` 文件(light DOM):同样行为
- ✅ 空白处右键(WebKit 不 collapse 场景):无退化
- ✅ 红色覆盖块视觉:md / py 一致,色号与 Windows 同操作一致(Microsoft Fluent #d13438)
- ✅ 菜单关闭(加入聊天 / 取消 / 点空白)立即清掉 overlay + 原生 selection + Pierre 行选区,无视觉残留
- ✅ 滚动文档自动清 overlay,避免 viewport rect stale 错位
- ✅ 模型可见文本:与 `加聊天-preview-fix` 已有的 synthetic text + preview 通道兼容,本 feat 不动 preview
- ✅ Pierre 上游 0 改动,无 override 配额消耗
- ⚠️ 若用户拖选 → 等 30s+ → 再右键,30s 窗口外的 history 不会被挑(用户体感:30s 静止后右键拿到的是当前 caret/word,这是合理 fallback)

## 回归测试点

均按 user 在 release `.app` 实测(`packages/desktop/src-tauri/target/release/bundle/macos/DeskFox Dev.app`,完整 bundle 构建):

- **R1** `.py` drag 选 ≥2 行 → 文字上右键 → 菜单"添加到聊天窗口"携带完整原始多行 → ✅(诊断面板验证 picked.idx=15 picked.len=80,栈里 [4..N] 的 1-3 字 collapse 词正确跳过)
- **R2** `.md` 文件 → ✅
- **R3** 空白处右键 → ✅(无退化)
- **R4** 红色覆盖块在原始选区上,md / py 视觉一致 → ✅
- **R5** 加入聊天 / 取消 / 点空白关菜单 → 红色 + 原生选区 + Pierre 行选区全消失 → ✅
- **R6** 滚动文档 → 红色覆盖自动清 → ✅
- **R7** 模型回答能复述选中文字(与 `加聊天-preview-fix` 链路兼容)→ ✅

## review 自检

- [x] 仅触动 fork 白名单(`packages/app/src/pages/session/file-tabs.tsx` + `docs/features/`)
- [x] 无 FORK marker 需求(整段右键加聊天逻辑本来就是 fork-only,非新动上游)
- [x] git diff --stat insertions 在 500 阈值内(225 行 ✓)
- [x] 无新增依赖
- [x] 无"顺手改"未记录(诊断阶段加过 Tauri `devtools` Cargo feature,定位完成已撤回)
- [x] typecheck 全过(14/14)
- [x] release `.app` 完整构建过(包含 sidecar + .app + .dmg)
- [x] User 双击 R1-R7 全过

## 已知遗留

- **30s 历史窗口边界**:用户拖选完静置 ≥30s 再右键,history 已过期,fallback 走 live selection(可能是 collapse 后单词)。实际场景概率低 — 真踩坑再放宽窗口或加"过期前最长"重试逻辑
- **滚动时直接清 overlay 而非 follow scroll**:实现简单,菜单生命周期短(用户开了菜单立刻点选项),scroll 概率低。如果未来用户反馈"我开了菜单想先滚一下看上下文",再实现 rect 跟踪
- **CSS Custom Highlight API**:本 feat 验证 macOS WKWebView 上 `delete()` stale 渲染,以后 fork 内其他视觉高亮需求(如果有)请直接用 overlay div 方案,**避开** Custom Highlight

## 走过的弯路汇总(与 2-plan.md 走过的弯路段呼应)

- 三轮"以 mousedown 为锚点"方案全部失败 — 详见 plan 决策轨迹四轮表
- CSS Custom Highlight 死路 — 改 overlay div 解决
- `--no-bundle` 不更新 .app 的踩坑(白测两轮)— 已记入 memory `feedback_no_bundle_pitfall.md`

## 回退方法

```
git revert <code commit hash>
```

单文件改动,无 schema 变更,无 server 端依赖,可直接 revert。docs 可保留作为决策记录(尤其 plan 的四轮迭代表对未来类似 WebKit 适配工作有参考价值)。
