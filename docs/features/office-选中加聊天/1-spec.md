---
feat-id: office-选中加聊天
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# office-选中加聊天 — 1-spec(需求 + 验收)

## 背景

需求池主索引 `DeskFox.Ai 需求池.md:31` 一行入池久未推进:

> 🔴 PPT / Word / Excel 文字选中复制,加到聊天窗口等

2026-05-24 user 远程开发模式下拉出来重新评估,深度技术调研后(详 `OPENCODE-PLAN/需求池/office-选中加聊天-架构调研.md`)发现:

1. **基础设施已就位**:office 预览走 `soffice → PDF → PDF.js`,而 `pdf.tsx:117-137` 已经实装 textLayer(canvas + 透明 DOM 双层),office 文本天然 DOM 可选,`window.getSelection()` 直接拿到 string。
2. **不该再加一套 menu**:chat / MD viewer 已分别有自己一套右键菜单(`chat-selection-menu.tsx` / `file-tabs.tsx mdMenu`),若再为 PDF/office 各自加一套,长期会演变成 4-6 套并列、UX 漂移,违背 CLAUDE.md "绝对单一,不分层、不双套、不双轨" 元原则。
3. **借机统一**:把"选中加聊天"这件事在所有格式上做漂亮 —— 一个 `ContextMenuHost` + 可插拔 `SelectionProvider`,本 feat v1 覆盖两处(chat / PDF/office),MD viewer 等 v2 跟 CodeMirror 一起做(理由见 §范围限定)。

## 与「office WYSIWYG 编辑」决议的关系(2026-05-24 拍板)

同日 user 重新评估"office 文件能否在文件查看区编辑"。结论(详 `docs/office-viewer-plan.md` "已知约束" + 调研 §1.4):

- **WYSIWYG office 编辑不重启**:浏览器端 office 编辑库覆盖不全、UNO bridge 等同重写 OnlyOffice、转中间格式必丢数据 —— 单人 + AI 在 1.0 ship 前做不出不丢数据的编辑体验,"会丢数据的编辑"比"不能编辑"更糟。
- **AI agent 编辑通道由本 feat 自然接通**:user 选中 office 文本 → 加聊天 → AI 用 `python-docx` / `openpyxl` / `python-pptx` 改原文件 → 重走 office→PDF 管线预览。**本 feat 在产品语义上吃掉"office 编辑"用户需求**,只是入口形态从 WYSIWYG 变成 AI agent。

未来任何人(包括 user 自己)再从"office 编辑"角度提需求,先回这两份文档判断 AI agent 通道是否已经满足,再考虑是否真的需要重启 WYSIWYG。

## 用户视角(交付物)

### 交付 1 — office / PDF 文件预览中"选中加聊天"

**user 操作**:
- 双击 `.docx` / `.xlsx` / `.pptx` / `.pdf` 文件打开预览
- 鼠标拖选预览中的文字(走 PDF.js textLayer)
- 右键 → 自家菜单弹出,2 项:
  - **添加到聊天窗口**(switch 到 input 模式,填可选问题,Ctrl/Cmd+Enter 提交)
  - **复制**(Ctrl+C 提示)
- 提交后,引用块 `> 选中文字` + 可选问题 拼到 composer 末尾,焦点跟到输入框

**与 chat / MD viewer 体验完全一致**(同一 UI、同一拼接逻辑、同一 toast)。

### 交付 2 — chat 选区菜单透明迁移到新架构

**user 操作**:无变化 —— chat 选区右键流程在 user 眼里完全一样(同样的菜单、同样的红色 highlight、同样的输入框、同样的 Ctrl+Enter 快捷键、同样的 toast)。

**架构变化**(user 看不到但长期受益):`chat-selection-menu.tsx` 改成薄壳,真实逻辑下沉到 `ContextMenuHost` + `DomSelectionProvider`,未来加新格式(MD viewer / iframe / OCR / CodeMirror)只需新写一个 Provider,菜单 UI / 引用拼接 / focus / toast 永远只有一份。

**MD viewer 不在 v1 范围**:MD 文件的 `mdMenu`(`file-tabs.tsx`)菜单除 添加到聊天 / 复制 外还有 **编辑 / 导出 Word** 两项 MD-format-specific 动作。v1 强行迁移会丢失这两项 user 已有功能;若 v1 就给 Provider 加 `getMenuItems()` 扩展,接口被单一 use case 拍形状容易设计偏。**v2 跟 CodeMirror 一起做**:那时手里同时握着 chat / PDF/office / MD viewer(带编辑/导出 Word)/ CodeMirror 四个真 Provider use case,接口扩展形状才会拍对。

### 交付 3 — 限制声明 + UI 兜底入口

**user 操作**:
- 选中范围在 office 文件**正文段落 / 表格单元格**时:正常加聊天
- 选中范围里有**公式 / 艺术字 / SmartArt / 图表 / 嵌入图片**:这些被 soffice 光栅化,选不到 —— **菜单灰显**,tooltip 写"本格式暂不支持选区,试试用本机软件打开"
- **PDF/office 预览顶栏常驻"用本机软件打开"按钮**(复用 `FileTooLarge` 已有组件入口),给"我就是要编辑原始格式"的 user 永久兜底

## 验收标准

### 架构

1. ✅ `packages/app/src/utils/context-menu-host/` 目录建立,含 `host.tsx`(组件)+ `provider.ts`(interface)+ `dom-provider.ts`(实现)
2. ✅ `SelectionProvider` interface 含 `providerName: string` / `matches(target): boolean` / `getSelection(target): {...} | null`(**同步契约**写在 JSDoc)/ `clear(): void`
3. ✅ Host 是 Solid 组件,根布局挂一次,document-level capture 阶段监听 contextmenu
4. ✅ `DomSelectionProvider.matches()` 识别 `[data-slot="session-turn-list"]` + `[data-slot="pdf-viewer"]` 两处(v1 范围;MD viewer 留 v2)
5. ✅ Provider 路由策略:first match wins(v1 唯一 Provider,后续按注册顺序遍历)

### 功能行为

6. ✅ PdfViewer 容器加 `data-slot="pdf-viewer"`(`packages/ui/src/components/document-viewer/pdf.tsx`,**改上游文件必加 FORK marker**)
7. ✅ PDF/office 预览选区右键 → 菜单出现位置在鼠标 = `event.clientX/Y`
8. ✅ 选区为空 → 菜单两项灰显 + tooltip(沿用 `menu-always-show-with-disabled` 哲学)
9. ✅ "添加到聊天窗口" → 走 `composeQuotedMarkdown` + `insertTextIntoPrompt` + `focusChatInput` 三件套,与 chat 体验对齐
10. ✅ "复制" → `navigator.clipboard.writeText` + 关菜单
11. ✅ 红色 highlight overlay(`rgba(209, 52, 56, 0.5)`)在 input 模式下兜底显示选区,滚动时清除
12. ✅ Esc / 点空白 / 提交 → 关菜单 + 清 overlay + 清原生选区

### chat 透明迁移

13. ✅ `chat-selection-menu.tsx` 改为薄壳:`<ChatSelectionMenu />` 仍可用,内部委派 Host
14. ✅ `message-timeline.tsx` 引用 `ChatSelectionMenu` 不动(props API 兼容)
15. ✅ chat 选区右键现有所有行为(menu/input 双模、highlight、Ctrl/Cmd+Enter、toast)1:1 保留

### 跨页选区兜底

16. ✅ 选区跨越多个 `.pdf-page-wrapper`(`pdf.tsx:205` 类名)时,检测到 → 显示 toast "请分段选中(跨页选区暂不支持)",不阻止菜单弹但不传部分内容到 composer
17. ✅ v1 **不引入** trigger render 逻辑(防止改坏 pdf.tsx 现有 IntersectionObserver 时序)

### UI 兜底

18. ✅ PDF/office 预览顶栏常驻"用本机软件打开"按钮(复用或 mirror `FileTooLarge` 组件已有的入口逻辑)

### 测试(治理 v3.1 双清单)

19. ✅ **Logic 清单**(`dom-provider.ts` / Provider interface 实现):**行覆盖率 ≥ 80%**
    - unit: matches() 在 chat-log / md-viewer / pdf-viewer / 其他 target 四种 case
    - unit: getSelection() 在 mock textLayer DOM 上取文本(空选区返 null,有选区返 text + rects)
    - unit: 跨页选区检测函数
20. ✅ **View 清单**(`ContextMenuHost` 组件):**≥ 1 e2e happy path**
    - e2e fixture PDF 加载 → 选文字 → 右键 → 菜单弹 → 提交 → composer 含引用块 + focus
    - e2e textLayer 金丝雀(pdfjs-dist 升级时这个 e2e 是早期预警)
21. ✅ chat 选区现有 e2e(若有)迁移后复跑 pass

### 文档

22. ✅ 三文档齐全(1-spec / 2-plan / 3-changelog)
23. ✅ `docs/features/INDEX.md` 加条目
24. ✅ `本仓 改动日志.md` 索引表新增一行
25. ✅ commit message 全部挂 `[feat: office-选中加聊天]`
26. ✅ 调研文档 `OPENCODE-PLAN/需求池/office-选中加聊天-架构调研.md` 头部状态从"等择机启动 feat" 改为"feat 进行中 / 已完成"

## 范围限定

### v1 in-scope(本 feat)

- `ContextMenuHost` + `SelectionProvider` interface(**仅 `getSelection()`,不含 `getMenuItems()`**)
- `DomSelectionProvider` 覆盖两处:chat / PDF/office
- chat-selection-menu 薄壳迁移(transparent migration)
- 跨页选区 toast 兜底
- "用本机软件打开"兜底入口常驻
- Phase 1 e2e(textLayer 金丝雀 + happy path)

### v1 非 in-scope(后续 Provider 增量做)

| 阶段 | 内容 | 触发 |
|---|---|---|
| v2 | **MD viewer + MD 编辑器**:`DomSelectionProvider` 扩 `[data-slot="md-viewer"]` + 新加 `CodeMirrorSelectionProvider`;**同时扩 Provider interface 加 `getMenuItems()`** 让 Provider 贡献"编辑/导出 Word"等 format-specific 菜单项 | 下次触动 MD 编辑器选区时顺手做 |
| v3 | `IframeSelectionProvider`,HTML 预览 iframe 选区(postMessage 协议) | user 真反馈"HTML 预览选不到字"再启动 |
| v∞ | `OcrSelectionProvider`,图片框选 → OCR → 选中 | 等 OCR feat 立项时再加 Provider |

**为什么 MD viewer 不在 v1**:MD 菜单除 添加到聊天 / 复制 外还有 **编辑 / 导出 Word** 两项 MD-specific 动作。v1 仅有 chat + PDF/office 两个 use case 凭想象设计 `getMenuItems()` 接口形状容易拍偏(CLAUDE.md "三相似行优于过早抽象")。v2 阶段手里同时握着四个真 Provider use case(chat / PDF/office / MD viewer / CodeMirror)再扩接口,设计形状才对。**v1 终态架构 ≠ 最终架构,但 v1 → v2 是同一个终点的两步走**。

**为什么 iframe / OCR 不在 v1**:涉及 postMessage / cross-origin / sandbox / async 选区,跟 office 强行绑会把简单 feat 拖成大 feat。这些 Provider 必须自己做 "loading 态菜单"(getSelection 同步契约的真正破口)—— 留 v3 / v∞,届时给 Host 加 async Provider 支持(可能引入 `getSelectionAsync()` 平行接口)。

## 限制声明(spec 必须写明,UI 也表达)

v1 **明确不支持**:

1. ❌ office 文件里的**公式 / 艺术字 / SmartArt / 图表 / 嵌入图片中的文字** —— soffice 光栅化后无 textLayer
2. ❌ **跨页选区**(>1 页)—— textLayer 懒加载,v1 toast 提示分段;v2 看用户痛点再升级
3. ❌ **HTML iframe 预览**里的选区 → v3 范围
4. ❌ **图片 OCR 选区** → 未来 Provider
5. ❌ **保留原文格式**(粗体/斜体/链接)→ v1 引用块只取纯文本;格式保真是更大命题,单独评估
6. ❌ **WPS / Office 原生格式编辑** → 用"用本机软件打开"按钮调外部软件;AI agent 编辑通道见 §"与 office WYSIWYG 编辑决议的关系"

## 关联文档

| 文档 | 关系 |
|---|---|
| `OPENCODE-PLAN/需求池/office-选中加聊天-架构调研.md` | 调研结论(本 spec 承继其架构决策) |
| `docs/office-viewer-plan.md` § "已知约束" | office 编辑决议(2026-05-24 v1.1 加 AI agent 通道段) |
| `docs/features/chat-selection-menu/` | chat 选区菜单 2026-05-15 feat(v1 重构对象) |
| `docs/features/chat-input-focus-follow/` | focus helper 2026-05-21 feat(本 feat 复用) |
| `packages/app/src/pages/session/chat-selection-menu.tsx` | v1 重构对象,行为对齐基线 |
| `packages/ui/src/components/document-viewer/pdf.tsx:117-137` | textLayer 实装位置(关键基础设施) |
| `packages/opencode/src/file/libreoffice.ts` | 后端 office→PDF 转换 + 缓存(本 feat 不动) |
| `OPENCODE-PLAN/需求池/REQ-025 大文件预览统一防护.md` | `FileTooLarge` 组件提供"用本机软件打开"兜底,本 feat 复用 |
| `docs/governance/自动化测试规范.md` v3.1 | 双清单 Logic ≥ 80% + View ≥ 1 e2e |

## 决策点(§9 user 拍板,2026-05-24)

| # | 问题 | 决策 |
|---|---|---|
| 1 | Host = component vs singleton | **component**(Solid 组件,根布局挂一次)|
| 2 | Provider 优先级 / 互斥 | **v1 无,first match wins** |
| 3 | 引用块带"来自 xxx.docx" 元信息 | **v1 不带**(保持简洁)|
| 4 | 跨页选区 v2 是否做 | **v1 toast 提示,数据驱动**(看用户反馈再说)|
| 5 | i18n 文案 namespace | **复用 `fileViewer.menu.*`** |
| 6 | 测试 fixture office 文件 | **自家造 minimal** docx / xlsx / pptx 各 1(正文 + 表格 + 1 图)放 `packages/app/test/fixtures/office/` |
