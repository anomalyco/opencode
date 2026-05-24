---
feat-id: office-选中加聊天
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# office-选中加聊天 — 3-changelog(实际改动)

## 总览

| 维度 | 值 |
|---|---|
| 状态 | v1 done(View 清单 e2e 留 backlog,等 Phase ③ infra ready) |
| 起止 | 2026-05-24(单日完成 Steps 1-7,Step 8 user QA 待办)|
| commit 数 | 8 笔 |
| 净增行 | +1302 / -257 |
| 改上游文件 | 0 个(wrapper 替代避开 R4 黑名单)|
| R4 override | 0 笔 |
| 测试 | 19 单测 pass(Logic 清单 ≥ 80%)|

## 用户视角变化

1. **chat 选区右键**(已有功能)— 视觉完全无变化,UI 透明迁移到 ContextMenuHost
2. **PDF / office 选区右键**(新增)— 加到聊天 / 复制,UI 跟 chat 一致
3. **PDF / office 预览顶栏新增"用本机软件打开"按钮** — 永久兜底入口,公式/图表/艺术字选不到时调外部软件
4. **跨页 PDF 选区** — 自动检测,菜单"添加到聊天"灰显 + 内联提示"请分段选中"

## 文件改动清单

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/utils/context-menu-host/provider.ts` | 新 | +56 |
| `packages/app/src/utils/context-menu-host/dom-provider.ts` | 新 | +96 |
| `packages/app/src/utils/context-menu-host/host.tsx` | 新 | +300 |
| `packages/app/src/utils/context-menu-host/__tests__/dom-provider.test.ts` | 新(19 测试)| +278 |
| `packages/app/src/pages/session/chat-selection-menu.tsx` | 重构(258 → 30 薄壳)| +30 / -254 |
| `packages/app/src/pages/session/file-tabs.tsx` | 加 wrap + 顶栏按钮 + isPdfLikePath helper | +51 / -3 |
| `packages/app/src/i18n/{zh,en,zht}.ts` | crossPageHint key 三语 | +6 |
| `docs/features/office-选中加聊天/{1-spec,2-plan,3-changelog}.md` | 新 | +484 / 本笔 |
| `docs/office-viewer-plan.md` | AI agent 编辑路径段(首 commit) | +4 / -1 |

## commit 链

| # | hash | type | 一句话 |
|---|---|---|---|
| 1 | `6e3eb2b3c` | docs | office-viewer-plan 加 AI agent 编辑路径段 + 引向需求池调研 |
| 2 | `afa27565e` | docs | 1-spec + 2-plan + 3-changelog 骨架 — 统一菜单 + Provider 架构 |
| 3 | `9dc090355` | feat | SelectionProvider 抽象 + DomSelectionProvider 实现 + 19 单测 |
| 4 | `9dc8e2ddd` | feat | ContextMenuHost Solid 组件实装(menu/input 双模 + 高亮 overlay)|
| 5 | `7d1d491dc` | feat | file-tabs renderDefault 对 PDF/office 加 data-slot wrapper |
| 6 | `9f0a73352` | refactor | chat-selection-menu 薄壳化 — UI 下沉到 ContextMenuHost |
| 7 | `7749509d2` | feat | 跨页选区菜单 hint + 按钮 disabled + 三语 i18n |
| 8 | `45f0e8a58` | feat | PDF/office 顶栏"用本机软件打开"按钮常驻 |

## 关键设计决策回顾

### A. v1 范围 = chat + PDF/office,MD viewer 留 v2

调研原 plan 是"v1 一次性吃掉 3 个场景"。实施时发现 `mdMenu`(file-tabs.tsx)除 添加到聊天/复制 外还有 **编辑 / 导出 Word** 两项 MD-format-specific 动作。v1 只 chat + PDF/office 两个 use case 设计 `getMenuItems()` 接口形状容易拍偏(CLAUDE.md "三相似行优于过早抽象")。

**结论**:v1 范围缩到 chat + PDF/office;v2 跟 CodeMirror 一起做时手里同时握着 chat / PDF/office / MD viewer / CodeMirror 四个真 Provider use case,扩 `getMenuItems()` 接口形状才能拍对。

详 1-spec § 范围限定 + v1 决策方案 A 的论证。

### B. data-slot wrap 在 file-tabs.tsx 而非 pdf.tsx

原 plan Step 2 是改 `packages/ui/.../pdf.tsx` 加 `data-slot="pdf-viewer"`。pre-commit (4.1) 拦截:`packages/ui/` 在 R4 黑名单。

**评估 wrapper 替代**:在 `file-tabs.tsx renderDefault` 对 pdf-like 文件外层加 `<div data-slot="pdf-viewer">`,等价效果(target.closest 行为一致),完全避开黑名单。**采用,0 R4 override 配额消耗**。

副产品:跟随上游 pdf.tsx 升级时 0 冲突。

### C. 跨页选区 inline hint 而非 toast

每次右键弹 toast 打扰。改用菜单内联文字提示 + 按钮 title tooltip — 不打断 user,提示就在视线内。

### D. View 清单 e2e 留 backlog

e2e 基础设施 Phase ③(真桌面 Tauri WebDriver)还卡 saveDialog mock,完整测试 `test.fixme`。Phase ② web mock 无法跑 pdfjs 真渲染。

按治理 v3.1:**View 清单硬门槛等 e2e 基础设施 setup 后生效**。Logic 清单 ≥ 80% 已通过 Step 1 的 19 单测达成。

backlog 项:
- pdfjs textLayer 金丝雀(pdfjs-dist 升级早期预警)
- happy path e2e(加载 fixture PDF → 选字 → 右键 → 提交 → composer 含引用块)
- WebView2 vs WebKit 跨平台选区行为差异(Phase 2 真桌面 e2e 才能覆盖)

等 Phase ③ ready 再补,记需求池 `e2e-测试基础设施-进展.md`。

## 回归测试

| 维度 | 状态 |
|---|---|
| `bun run typecheck` monorepo | ✅ 全过(每 commit 后) |
| `bun test src/utils/context-menu-host` | ✅ 19 pass(独立 Logic) |
| `bun test src/pages/session` | ✅ 41 pass / 1 file-tree.test.ts pre-existing Kobalte SSR fail(与本 feat 无关) |
| pre-commit (4.1/4.2/4.4/4.5) | ✅ 每笔 commit 全过 |
| chat 选区现有 e2e(若有)透明迁移复跑 | 留 user QA |
| user 真桌面 QA(docx/xlsx/pptx 真文件)| **Step 8 待办** |

## 回退方法

每笔 commit 单一主题,可独立 revert(P4 可逆原则)。最坏情况:

- 若 Host 实装有 bug:revert `9dc8e2ddd`,chat-selection-menu 薄壳化也一起 revert(`9f0a73352`)
- 若 wrapper 不生效:revert `7d1d491dc`,PDF/office 回到老版无 selection menu
- 若顶栏按钮干扰布局:revert `45f0e8a58`,wrap 退回 `class="contents"`
- 若 i18n 报错:revert `7749509d2`,跨页选区菜单不显示 hint(但仍 disable 按钮)
- 完整回退:`git revert` 本 feat 全 8 笔 commits

## 未来增量(v2+)

| 阶段 | 内容 | 触发 |
|---|---|---|
| v2 | **MD viewer + MD 编辑器**:扩 Provider interface 加 `getMenuItems()` 让 Provider 贡献 format-specific 动作(编辑 / 导出 Word)。同时迁移 `file-tabs.tsx mdMenu` 到 Host | 下次触动 MD 编辑器选区时顺手做 |
| v3 | `IframeSelectionProvider`,HTML 预览 iframe 选区(postMessage 协议) | user 真反馈"HTML 预览选不到字"再启动 |
| v∞ | `OcrSelectionProvider`,图片框选 → OCR | 等 OCR feat 立项时一起 |

## Follow-up — 2026-05-25 第 2 轮真桌面 QA 暴露的 3 个 bug + R4 override

### 第 1 轮 QA 暴露 bug(已修)

- **PDF/office 预览右键菜单全灰显**(2026-05-25 user 实测):root layout.tsx:2371 全局 `select-none` Tailwind class 只白名单 input/textarea/contenteditable → textLayer 的普通 `<span>` 继承到 select-none → 文字无法选中。chat 能选靠 message-part.css:709-710 单独 user-select:text override。
  - **修法**:file-tabs.tsx 的 pdf-viewer wrap class 加 `select-text`,user-select CSS 继承传到 textLayer → span。`52734f9d9` 1 笔 hot-fix commit。

### 第 2 轮 QA 暴露 bug(R4 override 修)

第 1 轮修完文字能选了,但暴露 3 个新问题:

| # | 现象 | 根因 | 性质 |
|---|---|---|---|
| 1 | 选两行 → 选区扩到整页 | pdfjs-dist 5.6.205 不导出 TextLayerBuilder,我们用 raw `TextLayer` class 渲染。raw class 不带 `.endOfContent` 哨兵元素 + `.selecting` class 切换机制 — 浏览器 native selection 沿 DOM order 扩展到整页 spans | 缺机制 |
| 2 | 选区中间多字"没底色" | textLayer span 绝对定位 + DOM 顺序 ≠ 视觉顺序 — 部分视觉中间的 span 落在 range start-end 之外,没 selection highlight | bug 1 视觉副产物 |
| 3 | pptx 完全选不到 | 验证 pptx → PDF 有 `/Type/Font` + `/ToUnicode` + BT...ET text block,理论可选。但 PowerPoint 幻灯片每段文字独立 span + 视觉/DOM 顺序撞得更严重 → 视觉上看像"完全选不到字" | bug 1/2 在 pptx 上的恶化形态 |

### R4 override 论证(单 person 场景复核报告)

**override 对象**:`packages/ui/src/components/document-viewer/pdf.tsx`(R4 黑名单 `packages/ui/`)

**改动**:
- 文件顶部加模块级 singleton `ensurePdfTextSelectionMouseupHandler()` — 一次性安装 document.mouseup listener,释放任意 textLayer 上的 `.selecting` class
- textLayer.render() 完成后追加 `<div class="endOfContent">` 哨兵 + textLayer mousedown listener 加 `.selecting` class
- 配套 CSS 已在 `pdfjs-dist/web/pdf_viewer.css` 内置(`.textLayer .endOfContent` + `.textLayer.selecting .endOfContent`)无需新加

**wrapper 不可行性论证**:

| 替代方案 | 不可行理由 |
|---|---|
| file-tabs.tsx wrap 层 MutationObserver 注入 endOfContent | ① textLayer render 异步,observer 触发时机难判定(spans 还在追加)。② 跨 page 切换 / unmount / resize 需手动 cleanup,observer 生命周期跟 PdfViewer 解耦,**fragility 远超改 pdf.tsx 10 行** |
| 用 pdfjs-dist PageView 替换 raw TextLayer 调用 | pdfjs-dist 5.6.205 NPM 包不导出 PageViewBuilder / TextLayerBuilder 等高层类(grep build/pdf.mjs 验证)。要拿这些类必须直接 import 内部模块路径或自己实现,**比改 pdf.tsx 大 10 倍** |
| 在外层加 document-level 选区监听 + 自己实现边界 | 等于在 SolidJS 组件外重写浏览器 native selection 行为,**与 PDF.js 现有 textLayer 渲染解耦失败**。endOfContent 必须挂在 textLayer 容器内 |

→ wrapper 替代均不可行,R4 override 是合理路径。

**风险评估**:

- ✅ **跟随上游升级 0 冲突**:改动是 textLayer.render() 完成后**追加** DOM + listener,不动 pdf.tsx 既有逻辑结构。上游升级 textLayer API 时,FORK-BEGIN/END 块容易 spot + 适配
- ✅ **改动范围最小**:总 ~25 行(模块顶 11 行 helper + render 后追加 ~14 行),全包在 FORK 标记内
- ✅ **复用 pdfjs CSS**:`.textLayer .endOfContent` / `.textLayer.selecting` 是 pdf_viewer.css 原生 class,我们只是补 DOM + class 切换 — pdfjs 升级 CSS class 改名时跟其他 pdfjs 使用方一起踩坑,不是 fork 独有风险
- ✅ **mouseup 全局 singleton**:用 `pdfTextSelectionMouseupHandlerInstalled` flag 保证只 install 一次,SSR 安全(`typeof document === "undefined"` 检查)
- ⚠️ **per-textLayer mousedown listener**:100 页 PDF = 100 个 mousedown listener。listener 跟 textLayerDiv 一起 GC(textLayerDiv 在 cleanup 时 replaceChildren 移除)— 无 leak,但大文件略增内存
- ⚠️ **touch 事件未处理**:pdf.js viewer 还处理 touchstart/touchend,v1 mouse-only。移动端不在 DeskFox 桌面范围,留 backlog

**配额消耗**:1 笔(R4 当季 2 笔配额,本次第 1 笔)。

**user 二次确认**:2026-05-25 user 在 office-选中加聊天 第 2 轮 QA 后看完三个方案(A/B/C)+ 我推荐 + wrapper 不可行性,回复"A" → 点头 commit。

### override commit

- `<待填>` fix(office-选中加聊天): pdf.tsx 加 endOfContent + .selecting class 修选区越界 `[override-blacklist]` `[feat: office-选中加聊天]` `[bug-repro: 选两行变选一页 + 字跳过没底色 + pptx 选不到]`

(commit hash 落地后回填)

---

## 已知 limitation(spec 已写明)

1. ❌ office 公式 / 艺术字 / SmartArt / 图表 / 嵌入图片中的文字(soffice 光栅化)→ UI 灰显 + 用本机软件打开兜底
2. ❌ 跨页选区 → toast inline 提示分段;v2 数据驱动是否升级
3. ❌ HTML iframe 预览选区 → v3 范围
4. ❌ 图片 OCR 选区 → 未来 Provider
5. ❌ 原文格式(粗体/斜体/链接)保真 → v1 引用块只取纯文本
6. ❌ WPS / Office 原生格式编辑 → "用本机软件打开"按钮永久兜底;AI agent 编辑通道见 1-spec § "与 office WYSIWYG 编辑决议的关系"
