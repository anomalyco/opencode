---
feat-id: office-选中加聊天
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# office-选中加聊天 — 3-changelog(实际改动)

## 总览

| 维度 | 值 |
|---|---|
| 状态 | v1 done — 含 QA 跟进 #1-#4(View 清单 e2e 留 backlog,等 Phase ③ infra ready)|
| 起止 | 2026-05-24 ~ 2026-05-25(2 天:首日交付 Steps 1-7,次日 QA 4 轮跟进打磨)|
| commit 数 | 主交付 8 笔 + Follow-up R4 override 2 笔 + QA 跟进 #1-#4 共 ~16 笔 |
| 净增行 | +1700 / -270(估算,含 QA 跟进集 + 诊断脚本)|
| 改上游文件 | 0 个产品代码(全 fork-only 新文件或 wrapper);R4 override 在 packages/ui/pdf.tsx |
| R4 override | 2 笔(TextLayerBuilder + `--total-scale-factor`,当季 2/2 配额满)|
| 测试 | 72 单测 pass(Logic 清单 ≥ 80%)|

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

主交付(2026-05-24):

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
| 9 | `6c797d27b` | docs | 3-changelog 填充 + INDEX/改动日志收录 |

第 1 轮 QA 跟进(2026-05-25 上半天):

| # | hash | type | 一句话 |
|---|---|---|---|
| 10 | `52734f9d9` | fix | PDF/office textLayer 加 select-text 启用选中 |
| 11 | `899c0254b` | fix | pdf.tsx 加 endOfContent + .selecting hack(后续证实未生效,见 #12)|
| 12 | `d5d27cb0b` | fix | pdf.tsx 换 TextLayerBuilder 正解 [override-blacklist] |
| 13 | `a4aac3265` | test | CDP 自测脚本初版 |
| 14 | `72b204d36` | fix | DomSelectionProvider 视觉 bbox 算法修视觉漏字 |
| 15 | `5238f8d93` | fix | Host 提到 Session 顶层 + 拖拽中实时 overlay |
| 16 | `33f4283d9` | fix | 视觉算法不再过滤 whitespace spans |
| 17 | `58dd2be3d` | fix | rects 按行合并消除字间天窗 |
| 18 | `648b79991` | fix | PDF/office 选区单色蓝(藏 native + overlay 改 chat 同色调)|

第 2 轮 QA 跟进 #1-#4(2026-05-25 下半天,本笔):

| # | hash | type | 一句话 |
|---|---|---|---|
| 19 | `ca09359e2` | fix | QA #1 — `--total-scale-factor` 修行末漏字 [override-blacklist] [bug-repro] |
| 20-22 | `3564f54c6` | fix | QA #2-#4 合并(host.tsx + dom-provider.ts 同文件两轮修改,合一 commit;含 quote 卡片接线 11 文件)[bug-repro] |
| 23 | `ea03331e9` | test | CDP 诊断 + 自测脚本集(16 个 mjs,QA 跟进诊断辅助)[large-diff]|
| 24 | `<本笔>` | docs | 3-changelog QA #1-#4 段 + 经验沉淀 T1-T7 + 总览统计 / INDEX / 改动日志同步 |

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

### R4 override commit 链(两笔)

**第 1 笔(失败方案 — 仅加 endOfContent + .selecting,缺动态重定位 → 无效)**

- `899c0254b` fix: pdf.tsx 加 endOfContent + .selecting class(**第 3 轮 QA 验证未生效**)
- 失败原因:pdf.js 官方 viewer 的真实机制是注册全局 `selectionchange` listener,**动态把 endOfContent 插入到 selection anchor 节点旁**作 DOM-order 屏障(详 pdfjs-dist 5.6.205 `web/pdf_viewer.mjs:6320` selectionchange handler)。我只加了静态 endOfContent 没装这个动态重定位 → 选区仍越界。
- **教训**:R4 override 前应直接读高层 source(TextLayerBuilder)而非凭直觉拼 CSS 机制。本应先验过再写。

**第 2 笔(正解 — 改用 TextLayerBuilder)**

- `<待填>` fix: 改用 `TextLayerBuilder`(`pdfjs-dist/web/pdf_viewer.mjs`)替代 raw TextLayer + 删除第 1 笔的 endOfContent 手写 hack
- 修法:
  - loadPdfjs() 同时 import `pdfjs-dist/web/pdf_viewer.mjs` 拿 TextLayerBuilder
  - renderPage 用 TextLayerBuilder 而非 raw TextLayer,Builder 自带完整 endOfContent 动态重定位 + 全局 selectionchange listener + .selecting class 切换 + abortSignal 生命周期管理
  - 加 `textLayerAbortController`(per file load 一个),在 cleanup / 新 file load 时 abort → TextLayerBuilder 自动清理 listener
  - 兼容性 fallback:`(viewer as any).TextLayerBuilder` 检查,pdfjs 升级移除时降级回 raw TextLayer
- 净改动:~30 行,全包 FORK 标记
- **配额消耗**:此次 R4 第 2 笔。当季 2/2 配额满,后续这季 packages/ui/ 锁死

(commit hash 落地后回填)

---

## Follow-up 第 2 轮 — 2026-05-25 QA 跟进 #1-#4

第 1 轮 R4 override(TextLayerBuilder)修完 user 重测后又暴露 4 个问题,按发现顺序处理:

### QA #1 — `--total-scale-factor` 修行末漏字(R4 override 第 2 笔,packages/ui/pdf.tsx)

- `<待填>` fix: pdf-page-wrapper 创建时设 `--total-scale-factor` CSS var = viewport scale
- **现象**:user 截图 "都可审计、可" / "署、私有化定制," / "不确定风险。" 三处**行末几字**没有蓝色 overlay 底色,但行中部分覆盖完整
- **根因 4 层链**:
  1. PDF.js 5.6.205 textLayer 通过 CSS var 体系算字号:`--text-scale-factor = --total-scale-factor × --min-font-size` → `font-size = --text-scale-factor × --font-height`(span 上 inline 设的)
  2. 官方 `PDFPageView.setScale()` 内部会 `setProperty('--total-scale-factor', scale)`,我们手搓 `renderPage()` 漏了这步
  3. var 未设 → CSS calc 失效 → font-size 走 browser fallback 13px(应为 16.5px)
  4. span 宽度 = 文字按 13px 排出来的宽度,**比 canvas 实际渲染窄 ~20%** → 文字溢出 span 右边界,但 visual bbox 算法以 `span.getBoundingClientRect().right` 为界 → 行末漏盖
- **诊断方法关键**:加 `outline:1px solid red` 给 textLayer span 然后截图肉眼对比 canvas 文字边界 → 一眼看出 textLayer 比 canvas 窄一截。**纯 DOM 数据看不出**(数据角度 span.right 跟 overlay.right 是吻合的,只是 textLayer 整体跟 canvas 不对齐)
- **修法**:`wrap.style.setProperty("--total-scale-factor", String(scale))` 1 行
- **验证**:CDP 实测 spanRight 从 1481→1617(覆盖 "私有化定制,"),overlay 完整覆盖 3 行末
- **配额**:R4 第 2 笔(当季 2/2 满 — TextLayerBuilder + scale-factor)

### QA #2 — pointerdown snapshot 修行间空白右键 collapse(host.tsx)

- `<待填>` fix: host.tsx 加 pointerdown right-button snapshot + contextmenu fallback
- **现象**:user 选中多行,右键落在**行与行之间的空白处** → 选区瞬间消失 + 菜单不弹
- **根因**:WebView2(Chromium)默认行为:右键到非选区元素时把 caret 移到 click 位置 → selection collapse 成 0 长度。PDF textLayer 是绝对定位 spans,**行间空白不属任何 span**;user 视觉上看到 overlay 覆盖此处(我们 visual bbox union 整行 rect 算的),但 DOM 上不属选区 → 右键 collapse → contextmenu 触发时 live getSelection 已空 → menu 不接管
- **修法**:
  - 加 `onRightClickPointerDown`(button=2 时):**在 mousedown collapse 之前**snapshot 选区(text/rects/range/bbox + timestamp)
  - `handleContextMenu` fallback:live 空 + snapshot < 500ms + 右键坐标落 snapshot bbox 内 → 用 snapshot,并 `addRange(snapshot.range)` 恢复 native selection
  - bbox 容差 ±4px 处理边缘 click
- **净改动**:~50 行,全在 host.tsx FORK 块内
- **验证**:CDP 实测 — 行间 13.7px 空白右键,菜单 open + 按钮 enabled + selection 保留 329 chars

### QA #3 — anchor/focus 修拖几行选中整页(dom-provider.ts)

- `<待填>` fix: 视觉 bbox 改用 `sel.anchor/focus` caret 坐标,不用 `range.getClientRects()` bbox
- **现象**:user 从段 2 line 1 "单一" 拖到段 2 line 4 "Claude"(4 行),overlay 扩到**整页**(title + 4 sections 全染蓝)
- **根因**:PDF.js textLayer span 的 **DOM 顺序 ≠ 视觉顺序**(复杂 PDF 标题/段落在 PDF text stream 里乱序很常见)。`range.getClientRects()` 沿 DOM 顺序遍历返回 rects,把"DOM 在 anchor 与 focus 之间但视觉跨页"的 spans 全算进 bbox → bboxTop = title.top / bboxBottom = section4.bottom → 算法收所有 y 在 bbox 内 spans → 整页 overlay
- **修法**:
  - 用 `sel.anchorNode/anchorOffset` + `sel.focusNode/focusOffset` 算 caret rect(`createRange + setStart/End 同点 + getBoundingClientRect`)
  - 用 anchor/focus 两点的 cy 作 bboxTop/bboxBottom(±2px 容差吃 caret 抖动)
  - selStartX/selEndX 同样用 anchor/focus,按 cy 大小(同行按 x)排出真实 start/end
  - fallback:anchor/focus 拿不到时落回 nativeRects bbox(罕见 — detached node)
- **净改动**:~50 行,dom-provider.ts FORK 块内
- **关键洞察**:`anchor/focus` 表达 user 真实意图(mousedown/mouseup 实际坐标),`range.getClientRects` 表达 DOM 解析结果。**user 意图维度更适合做视觉选区**,DOM 维度只在格式良序时才等价

### QA #4 — `commentOrigin: "quote"` 改卡片形式 + 跳过 filePart(B 方案)

- `<待填>` feat: PDF/office 选区不再塞 textarea 当 markdown blockquote,改为**卡片**(复用 `PromptContextItems`)+ LLM 端**只送选中文字 + 路径,绝不附二进制文件**
- **现象**:user QA "复制文案,形势不好" — textarea 长 `> ...` blockquote 难看
- **设计演进 3 步**:
  1. **A1(初版,有缺陷)**— 复用 `FileContextItem` 走 `commentOrigin: "file"`,卡片 OK 但 `build-request-parts` 给 PDF 强制 `text/plain` mime,LLM read 工具读整个 docx/pdf 二进制 = utf-8 乱码塞 context
  2. **C/D 备选驳回**— 多模态原生 PDF(只解 PDF,Office 不行,大文件爆 context);后台文本抽取(v1 infra 过大,v2 backlog)
  3. **B 终版**— 加 `commentOrigin: "quote"` 子型,`build-request-parts` quote 分支 **跳过 filePart**,只 emit text part(`formatCommentNote` 已含选中文字 preview),格式无关 + token 干净
- **修法 11 文件 ~80 行**:
  - **核心 2 处**:
    - `build-request-parts.ts` `isQuote` 分支 — `commentOrigin === "quote"` 时只回 text part,不附 file URL
    - `host.tsx` `submitToChat` — PDF/office 选区(`m.sourcePath` 非空)→ `prompt.context.add({..., commentOrigin: "quote"})`,空 comment 兜底 `(see selected text)`(否则 formatCommentNote 漏 preview)
  - **接线 2 处**:`file-tabs.tsx` pdf-viewer wrapper 加 `data-file-path={path()}` + `dom-provider.ts` `readPdfViewerFilePath` 透传到 `sourceMeta:{kind,path}`
  - **类型扩展 7 处**(commentOrigin 加 "quote"):`comment-note.ts` / `prompt.tsx` / `prompt-input.tsx` / `submit.ts` / `history.ts` / `pages/session.tsx` / `pages/session/file-tabs.tsx`
  - commentID = `quote-${textHash}-${ts}`(避免同 PDF 多次选区被 contextItemKey dedup)
- **设计决策记录**(为何 B 而非 A1/C/D):user 选区意图 = 引用一段,**不是让 LLM 读全文**;quote 路径格式无关(PDF/DOCX/PPTX/XLSX 同套代码)+ token 干净 + context window 友好 + 未来加"展开周围段落"是平滑加法
- **真实 LLM payload 验证**(SQLite `opencode.db` part 表):
  - user message `msg_e5dcf5d3c001cislgCk0cdtzsq` 只含 2 个 text part(1 空 + 1 formatCommentNote),**0 个 file part** ✓
  - LLM reasoning: "The user wants a one-sentence explanation of the selected text" — 正确理解意图
  - input tokens 14358(主要 Claude Code system prompt 开销,**无 docx 二进制乱码**;若 A1 路径会膨胀到几十 K)

### 经验沉淀(本次 2 天 4 轮 QA 提炼出的可复用教训)

**T1 — R4 override 改前必须读官方"完整 side effect 链"**

教训源:QA #1 scale-factor 漏设。第 1 笔 R4 用 TextLayerBuilder 时只读了 `builder.render()` 入口,没扫官方 `PDFPageView.setScale()` 的全套 side effect(CSS var / dataset / scrollIntoView 等)。下次改 pdf.tsx 应先 `grep -r "setProperty\|dataset\." node_modules/pdfjs-dist/web/` 把 setScale/setupSize 等钩子全 side effect 列出来 checklist 化。

**T2 — DOM 顺序 ≠ 视觉顺序是 PDF.js textLayer 的根本特性,凡是"沿 range 走"的浏览器 API 都不可信**

教训源:QA #3 整页选中。具体范围:
- `range.getClientRects()` 沿 DOM 顺序遍历 → 跨视觉跳跃
- 浏览器 native 蓝色高亮也沿 DOM 顺序 → 视觉中间漏字
- `selection.toString()` 沿 DOM 顺序拼接 → 顺序可能乱

**反向选 user 真实意图维度**:`sel.anchorNode/focusNode + offset` 反映 user 实际点击坐标,跟视觉强对应。改 PDF 选区相关功能默认用 anchor/focus,只有需要"linear DOM 顺序文字"时才用 range.

**T3 — 浏览器选区相关行为必须考虑"事件链中默认行为何时发生"**

教训源:QA #2 右键 collapse。WebView2/Chromium 默认在 mousedown 中处理 caret placement → selection collapse。我们的 contextmenu listener 在 mousedown 之后才触发 → 拿不到 collapse 前的状态。

**通用模式**:涉及选区/拖拽/focus 的功能,在 `pointerdown` capture 阶段 snapshot,在 `contextmenu` / `click` / `dragstart` 中用 snapshot 兜底。

**T4 — 架构选型时区分"复用一段代码"和"复用一条数据通路"**

教训源:QA #4 A1→B 演进。A1 看着是"max reuse" 复用 FileContextItem,但其实那条数据通路(file URL → read tool → text/plain 全文)是为**代码评审**设计的,语义不匹配 PDF quote 场景。"复用 UI" 和 "复用语义通路" 是两件事:UI 可复用,语义通路必须每次重新审视。

**判别原则**:看那条通路上的下游处理(read tool / mime 强制 / formatter)是否在你的输入数据形态下还做对的事。

**T5 — 大模型应用要分清"user 引用一段问问题" vs "user 让模型读全文" 的根本不同**

教训源:QA #4 B 方案 token 干净。前者只需要那段文字 + 用户问题;后者才需要附整个文件。**默认走前者**(token 便宜、context 不爆、格式无关),后者作为可 escalate 的扩展。这是 LLM 应用 UX 设计的基础区分,跟"全文 RAG vs 段落引用"是同一个二分。

**T6 — CDP 自测脚本是真桌面 QA 的好补充但不是替代**

本次 4 个 QA 全靠 user 真桌面截图反馈才发现:
- CDP `Input.dispatchMouseEvent` 合成事件**不一定触发**所有 native default(如右键 collapse)
- CDP 提供 DOM 数据真相,但不提供视觉/感知真相(scale-factor 错位看 DOM 数据看不出,看截图才能看出)

**结论**:CDP 自测能验"算法逻辑/数据流",真桌面 QA 必须验"视觉/感知/native 行为"。两者互补不替代。

**T7 — 调研撞墙 3 次没新信息立刻换层面(memory 已存)**

本次实战:QA #1 scale-factor 调研时,先连截 3 张 x-marker 截图都没定位根因,卡在"dump 数 vs 视觉数不一致"上。第 4 步切换到 source-level — 直接看 pdf.tsx 怎么调 TextLayerBuilder → 翻 pdfjs-dist CSS → 找 CSS var → 立刻定位。**降一层(从数据维度切到源码维度)才有突破**。

---

## 已知 limitation(spec 已写明)

1. ❌ office 公式 / 艺术字 / SmartArt / 图表 / 嵌入图片中的文字(soffice 光栅化)→ UI 灰显 + 用本机软件打开兜底
2. ❌ 跨页选区 → toast inline 提示分段;v2 数据驱动是否升级
3. ❌ HTML iframe 预览选区 → v3 范围
4. ❌ 图片 OCR 选区 → 未来 Provider
5. ❌ 原文格式(粗体/斜体/链接)保真 → v1 引用块只取纯文本
6. ❌ WPS / Office 原生格式编辑 → "用本机软件打开"按钮永久兜底;AI agent 编辑通道见 1-spec § "与 office WYSIWYG 编辑决议的关系"
