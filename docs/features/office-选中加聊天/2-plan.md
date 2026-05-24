---
feat-id: office-选中加聊天
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# office-选中加聊天 — 2-plan(实施计划)

## 规模:Medium(架构搭建 + 两处接入 + chat 迁移 + 测试)

估算:
- 新文件代码:~300 行(`host.tsx` ~150 / `provider.ts` interface ~30 / `dom-provider.ts` ~80 / 测试 ~50)
- 改上游文件:`pdf.tsx` +1 行 data-slot(FORK marker 2 行 = 3 行净增)
- 重构:`chat-selection-menu.tsx` 改薄壳(258 行 → ~50 行委派)
- 测试:Logic 清单 unit ~200 行(覆盖率 ≥80%) + View 清单 e2e ~80 行
- 文档:三文档 + INDEX + 改动日志索引行

总计 **~600 行净增 / 1 上游文件改 / 触动 ≤3 个 package**,Medium 偏上。

**v1 范围决策(2026-05-24 A 方案)**:MD viewer **不**在 v1。理由见 1-spec § 范围限定:v1 仅有 chat + PDF/office 两个 use case 设计 `getMenuItems()` 接口容易拍偏,等 v2 跟 CodeMirror 一起做时手里有四个真 use case 再扩接口才对。

## 架构(承 1-spec)

```
ContextMenuHost (Solid 组件, root layout 挂一次)
  │  document.addEventListener("contextmenu", handler, true)   ← capture 阶段
  │
  ▼
  for (const provider of providers) {
    if (provider.matches(target)) {
      const sel = provider.getSelection(target)  ← 同步契约
      if (sel) return openMenu(sel, event)
    }
  }
  // 无 provider 接管 → 不阻止原生(右键正常弹 WebView2 菜单)

Providers (注册顺序 = 优先级)
  ├─ DomSelectionProvider                       ← v1 唯一
  │   matches: target.closest('[data-slot="..."]')
  │   getSelection: window.getSelection() 同步读
```

## 实施顺序

### Step 1 — `context-menu-host` 基础(1d)

**1.1** 新建 `packages/app/src/utils/context-menu-host/provider.ts`(~30 行)

```ts
// FORK: 选区菜单 Provider interface — 统一菜单 + 可插拔 Provider 架构
// [feat: office-选中加聊天] 2026-05-24

export type SelectionResult = {
  text: string
  rects: DOMRect[]                              // highlight overlay 用
  range: Range | null                            // close 时 clear 用
  sourceMeta?: { kind: string; path?: string }  // 预留:未来"来自 xxx.docx"标记
}

/**
 * SelectionProvider 接口 — 把"如何拿选区"从"如何展示菜单 + 拼引用块"切开。
 *
 * 同步契约:getSelection() 必须同步返回。右键事件触发的那一瞬间菜单要出来,
 * async 取选区(等 textLayer 渲染 / iframe postMessage)会让菜单晚 N ms 弹,
 * UX 立刻烂。未来 async 源(iframe / OCR)需自己做 "loading 态菜单" UI。
 */
export interface SelectionProvider {
  readonly providerName: string                  // debug toast 时能说清来自哪个 provider
  matches(target: Element): boolean              // 我管不管这个 target
  getSelection(target: Element): SelectionResult | null
  clear(): void                                  // 菜单关时清选区
}
```

**1.2** 新建 `packages/app/src/utils/context-menu-host/dom-provider.ts`(~80 行)

```ts
// FORK: 基于 window.getSelection() 的 Provider — 覆盖 chat / MD viewer / PDF/office
// [feat: office-选中加聊天] 2026-05-24

import type { SelectionProvider, SelectionResult } from "./provider"

// v1 范围 — chat + PDF/office 两处。
// MD viewer 留 v2 跟 CodeMirror 一起做(那时 Provider interface 扩 getMenuItems()
// 让 Provider 贡献"编辑/导出 Word"等 format-specific 动作,接口形状由 4 个真 use case 验证)。
const SELECTORS = [
  '[data-slot="session-turn-list"]',  // chat
  '[data-slot="pdf-viewer"]',          // PDF / office(走 PDF.js textLayer)
]

export class DomSelectionProvider implements SelectionProvider {
  readonly providerName = "dom"

  matches(target: Element): boolean {
    return SELECTORS.some((sel) => target.closest(sel) != null)
  }

  getSelection(_target: Element): SelectionResult | null {
    if (typeof window === "undefined") return null
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const text = sel.toString()
    if (!text.trim()) return null
    const range = sel.getRangeAt(0).cloneRange()
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
    return { text, rects, range }
  }

  /** 跨页选区检测 — true = 跨多个 .pdf-page-wrapper,v1 toast 提示分段。 */
  spansMultiplePdfPages(range: Range): boolean {
    const ancestor = range.commonAncestorContainer
    const el = ancestor.nodeType === Node.ELEMENT_NODE
      ? (ancestor as Element)
      : ancestor.parentElement
    if (!el) return false
    const pages = el.querySelectorAll?.(".pdf-page-wrapper") ?? []
    let count = 0
    pages.forEach((p) => {
      if (range.intersectsNode(p)) count++
    })
    return count > 1
  }

  clear(): void {
    if (typeof window === "undefined") return
    try { window.getSelection()?.removeAllRanges() } catch {}
  }
}
```

**1.3** 新建 `packages/app/src/utils/context-menu-host/host.tsx`(~150 行)

承接 `chat-selection-menu.tsx` 的全部 UI 逻辑(menu / input 双模、highlight overlay、Ctrl/Cmd+Enter、toast、Esc/点空白关菜单),改为消费 Provider 列表而非硬编码 chat-log 单一 selector。

关键变化:
- `handleContextMenu` 内部 `for (provider of providers) { if (matches) { sel = getSelection(); if (sel) break } }`
- highlight overlay 用 `sel.rects` 直接绘制(原 `setSelectionHighlight(range)` 内部逻辑迁移到 Provider 返回的 rects)
- 跨页 toast 在 Host 层判定:`if (provider.providerName === "dom" && (provider as DomSelectionProvider).spansMultiplePdfPages(range))` —— 这里 Provider 暴露的 helper 可以做更优雅,留后续打磨

**1.4** unit 测试(`__tests__/dom-provider.test.ts` ~100 行)

- matches:四种 case(chat / md / pdf / 其他)
- getSelection:空选区返 null / trim 后空返 null / 有选区返完整 SelectionResult
- spansMultiplePdfPages:single / multi / 无 .pdf-page-wrapper
- clear:调后 `window.getSelection()?.rangeCount === 0`

### Step 2 — PdfViewer 加 data-slot(0.3d)

`packages/ui/src/components/document-viewer/pdf.tsx` 改上游文件,**加 FORK marker**。

```tsx
// 行 266 附近(最外层 wrapper div):
return (
  <div
    // FORK: 加 data-slot 让 ContextMenuHost 识别 PDF/office 预览区 [feat: office-选中加聊天] 2026-05-24
    data-slot="pdf-viewer"
    style={{ position: "relative", "min-height": "240px" }}
  >
```

净增 2 行(data-slot + FORK 注释)。

> **MD viewer data-slot 不在 v1 改**:v1 范围 A 方案不动 MD viewer,mdMenu 保留原状。v2 触动时再加 `[data-slot="md-viewer"]`。

### Step 3 — `chat-selection-menu.tsx` 改薄壳(0.5d)

258 行 → ~50 行薄壳,委派给 Host。

策略:
- `<ChatSelectionMenu />` 仍 export,内部直接 `return <ContextMenuHost providers={[new DomSelectionProvider()]} />`
- 或更激进:`message-timeline.tsx` 直接换成 `<ContextMenuHost />`,`ChatSelectionMenu` 留薄壳兼容(防其他地方引用未捕获)

**选哪条等代码现场决定**,先验"全 codebase grep ChatSelectionMenu"看引用面,然后挑伤害最小的。

### Step 4 — 跨页选区 toast 兜底(0.2d)

Host 层在拿到 SelectionResult 后:
- 若 Provider 是 DomSelectionProvider 且 `spansMultiplePdfPages(range)` 为 true
- → 菜单仍弹,但"添加到聊天窗口"按钮 disabled + 显示 toast "请分段选中(跨页选区暂不支持)"
- "复制"仍可用(toString 拿到的就是 visible 内容)

### Step 5 — PDF/office 顶栏"用本机软件打开"按钮(0.3d)

PdfViewer 上方加一个 utility bar(或在 file-tabs.tsx 渲染 PdfViewer 处包装),含"用本机软件打开"按钮 → 复用 `FileTooLarge` 已有的 reveal-in-explorer 逻辑(或 `shell.openPath` Tauri 命令)。

**实现位置选定**:`file-tabs.tsx` renderMedia 处加一个常驻 header(只对 office/pdf 显示),不污染 `PdfViewer` 通用组件本身。

### Step 6 — Phase 1 e2e(0.5d)

`packages/app/test/fixtures/office/` 放 3 个 minimal fixture(自家造,git track):
- `sample.docx` —— 1 段正文 + 1 个 2x2 表格 + 1 张内嵌图
- `sample.xlsx` —— 2 sheet,A1:C3 有文字,1 张图
- `sample.pptx` —— 1 张幻灯片,标题 + 正文 textbox + 1 个 SmartArt

e2e 测试(假设 e2e 基础设施已就位,若无则进 Logic-only fallback):
- 加载 `sample.docx` → 预览出 PDF(soffice 转过)→ 选中"段落正文"3 字 → 右键 → 菜单弹 → 点"添加到聊天窗口" → 输入"请总结" → Ctrl+Enter → composer 含 `> 段落正文\n\n请总结` + focus 在输入框
- chat 选区现有 happy path 复跑(走 ChatSelectionMenu 薄壳 → 新 Host)

**注**:若 e2e 基础设施还没 ready,Step 6 退化为 Logic-only(unit + 手动验证),View 清单门槛延后到 e2e infra ready(治理 v3.1 已写明)。

### Step 7 — 文档收尾(0.5d)

- `3-changelog.md` 写实际改动 + commit hash 列表 + 行数 + 影响范围 + 回归测试 + 回退方法
- `docs/features/INDEX.md` 新增条目
- `本仓 改动日志.md` 索引表新增一行
- `OPENCODE-PLAN/需求池/office-选中加聊天-架构调研.md` 头部状态改"feat 已完成"
- 三文档 status 字段:spec → in-progress → done

### Step 8 — user 真桌面 QA(user 侧)

user 拿实际 docx / xlsx / pptx 文件验证:
- 正文段落选区 → ✅ 正常
- 表格 cell 选区 → ⚠ 观察(soffice 转 PDF 时表格行内可能选区顺序乱)
- 公式 / 艺术字 / SmartArt → 预期选不到,菜单灰显
- 跨页选区 → 预期 toast 提示分段
- "用本机软件打开"按钮 → 真能调起 Word / Excel / PPT

发现问题进 changelog 的 follow-up 段或开 hot-fix commit。

## 文件改动清单

| 文件 | 类型 | 估算 |
|---|---|---|
| `packages/app/src/utils/context-menu-host/provider.ts` | 新 | ~30 |
| `packages/app/src/utils/context-menu-host/dom-provider.ts` | 新 | ~80 |
| `packages/app/src/utils/context-menu-host/host.tsx` | 新 | ~150 |
| `packages/app/src/utils/context-menu-host/__tests__/dom-provider.test.ts` | 新 | ~100 |
| `packages/app/src/utils/context-menu-host/__tests__/host.test.tsx`(可选) | 新 | ~50 |
| `packages/app/src/pages/session/chat-selection-menu.tsx` | 改 | 258 → ~50(净减) |
| `packages/ui/src/components/document-viewer/pdf.tsx` | 改上游 | +2(R2 FORK marker,加 data-slot) |
| `packages/app/src/pages/session/file-tabs.tsx` | 改 | +20(顶栏"用本机软件打开"按钮,只对 PDF/office;mdMenu **不动**)|
| `packages/app/test/fixtures/office/sample.{docx,xlsx,pptx}` | 新 binary | 3 个 fixture |
| e2e test 文件(位置待 e2e infra 确认) | 新 | ~80 |
| `docs/features/office-选中加聊天/{1-spec,2-plan,3-changelog}.md` | 新 | 三文档 |
| `docs/features/INDEX.md` | 改 | +1 行 |
| `本仓 改动日志.md` | 改 | +1 行 |
| `OPENCODE-PLAN/需求池/office-选中加聊天-架构调研.md` | 改 | 头部状态 |

**改上游文件**:1 个(`pdf.tsx`)+ 可能 1 个(`md-viewer` data-slot 视现状)。**未触及黑名单**,无需 R4 override。

## 测试要求(治理 v3.1 双清单)

### Logic 清单(进)

- `dom-provider.ts`(纯 helper:matches / getSelection / spansMultiplePdfPages / clear)
- 要求:行覆盖率 ≥ 80%

### View 清单(进)

- `host.tsx`(Solid 组件)
- 要求:≥ 1 e2e happy path
- **硬门槛延期生效**:等 e2e 基础设施 setup 后(治理 v3.1 已写明,opencode sidecar 或前端 mock mode)。若 v1 时点 infra 未 ready,落 Logic-only + 真桌面 QA 替代,e2e 留 backlog。

### bug-repro 测试

本 feat 是 new feature 不是 bug fix,无 bug-repro 要求。但若 user QA 阶段发现具体 bug,fix commit 必须带 `[bug-repro: <一句话>]` tag。

## 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| soffice 转 PDF 时表格 / 图表 / 公式光栅化,user 选不到字反复掉坑 | 🔴 高 | spec 写实在 + UI 兜底"用本机软件打开"按钮常驻 + 菜单灰显 + tooltip |
| pdfjs-dist 升级偷偷改 TextLayer API | 🟡 中 | e2e textLayer 金丝雀(选中→拿到非空 string)是早期预警 |
| `chat-selection-menu` 薄壳化破坏现有 chat 选区行为 | 🟡 中 | 行为对齐 1:1 验收清单(15 条);message-timeline.tsx 调用 API 不变;e2e 现有 happy path 复跑 |
| 跨页选区 v1 不做 trigger render,user 选不到完整跨页内容 | 🟢 低 | toast 提示分段;数据驱动是否做 v2 |
| WebView2 vs WebKit 选区 API 差异 | 🟢 低 | `window.getSelection()` 跨平台规范化好;Phase 2 真桌面 e2e 覆盖 Win + Mac 留 backlog |
| Host 与 chat-selection-menu 都 document-level capture listener,触发顺序混乱 | 🟢 低 | 薄壳化后 chat-selection-menu 不再独立监听,改委派 Host 单一入口 |
| Provider interface 未来扩展(async 源)污染同步契约 | 🟢 低 | interface JSDoc 写死"同步契约";iframe/OCR 进 v3/v∞ 时由自己做 loading 态 UI,不动 core |
| v2 给 Provider 加 `getMenuItems()` 时发现 v1 接口形状漏维度 | 🟢 低 | v1 不预先扩接口正是为防这个 — 三个真 use case 在手再设计 |

## 回退方法

最坏情况(v1 落地后发现某处 chat 选区行为破坏 user 不能接受):

1. revert 薄壳化 commit(chat-selection-menu.tsx 恢复 258 行原状)
2. `ContextMenuHost` 改为只服务 PDF/office,chat / MD viewer 走原路径
3. 牺牲架构统一性,但功能可用

完整回退:`git revert` 本 feat 所有 commits(P4 可逆原则保障 — 每 commit 一件事)。

## 决策点回顾(spec §决策点)

| # | 决策 |
|---|---|
| 1 | Host = Solid 组件,根布局挂一次 |
| 2 | Provider 路由 = first match wins,v1 唯一 Provider |
| 3 | 引用块 v1 不带"来自 xxx.docx" 元信息 |
| 4 | 跨页选区 v1 toast 提示,数据驱动 v2 |
| 5 | i18n 复用 `fileViewer.menu.*` 现有 key |
| 6 | Fixture 自家造 minimal docx/xlsx/pptx 放 `packages/app/test/fixtures/office/` |

## 开发中决策追加段(实施时实时追加)

> 实施过程中遇到原 plan 没预见的取舍 / 踩坑 / 方案推翻,**实时追加** note 到本段,记录"为什么改 plan"。完工后 changelog 引用本段作为决策轨迹。

(待实施时填充)
