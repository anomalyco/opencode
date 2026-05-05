---
feat-id: md-export-pdf-word
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-export-pdf-word — Spec

> 起草日期:2026-05-05
> **锁版日期:2026-05-05**(user 二轮 ack 完成,§8 三个开放点全部决议)
> 规模初判:**Medium**(预估 200-350 行,跨 3-4 个 fork-only 文件,**0 上游侵入**)
> 主题:文件查看器看 .md 时**右键加 2 项导出**(PDF / Word)— **效果保真为 P0 验收标准**
> 依赖前序:`md-office-improvements`(已 done,4 phase 让 md viewer 渲染了 frontmatter / Callout / Mermaid / TOC / 代码 syntax + 自家 typography)
> 依赖前序:`menu-i18n`(已 done,文件树菜单接入 i18n,本笔扩展同模式到 viewer 菜单)

---

## 1. 背景与动机

DeskFox 主受众是非编码人员,日常用例之一是"AI 帮我写完 / 整理完一份 markdown 文档,我要把它发给同事"。同事往往拿不到 .md 文件,或不熟悉 markdown 渲染 — **必须要 PDF 或 Word 这种"标准办公格式"才能直接发出去**。

`md-office-improvements` 把 viewer 的 markdown 渲染玩出花了(mermaid / callout / 脚注 / TOC / shiki 高亮等),**这些渲染成果应当能直接进 PDF / Word**,不能因为导出而丢掉。

---

## 2. 5 项需求详细规格

### 需求 #1 — viewer 内右键菜单加 2 项导出

**触发位置**:文件查看器内,看 `.md` 文件时,**鼠标右键**触发。

**显示规则(决议)**:
- **没选文字时**:右键弹"导出 PDF" / "导出 Word"两项(本笔加)
- **选了文字时**:右键弹原有"复制 / 加入聊天"两项(本笔不动,按现有 `mdMenu` 信号 state 走)
- 触发器:`window.getSelection()?.isCollapsed` 判定有无选区

> **理由**:选中文字时用户意图明确是"操作选区";没选区时意图通常是"操作整 doc"。语义最干净,菜单不混杂。

**作用范围**:仅 `.md` / `.markdown` 文件(走现有 `isMarkdownPath()` helper)。其他文件类型(.html / .pdf 等)右键行为不变。

### 需求 #2 — PDF 路线:走浏览器原生 print → 另存为 PDF

**实现**:
```ts
// 总共大约这个结构
const handleExportPdf = () => {
  // 关闭右键菜单(避免菜单出现在 print 截图里)
  closeMdMenu()
  // 等下一帧 DOM 更新完
  requestAnimationFrame(() => window.print())
}
```

**用户流程**:点"导出 PDF" → Tauri webview 弹系统 print 对话框 → 用户选"另存为 PDF"(Mac 左下角 PDF 下拉 / Win "Microsoft Print to PDF") → 选位置 → 保存。

**关键决策(P2)**:用 CSS `@media print` 规则隐藏不该进 PDF 的 UI 元素:
- 隐藏:文件树侧边栏 / 标签栏 / 应用 chrome / TOC 面板(可选)
- 保留:viewer 主体 markdown 渲染区(typography / mermaid / callout / 脚注 / shiki 高亮全保留)
- 让 markdown 区占满纸张宽度

**已知效果限制**(对 user 透明):
- ✅ 中文字体 / mermaid SVG / 所有 CSS / shiki 代码高亮 / callout / 脚注 — **100% 保留**(浏览器原生渲染)
- ✅ 用户能调页边距 / 横竖向 / 选页码范围 / 双面打印
- ⚠️ 长代码块跨页可能被切割(浏览器自带分页,中文段落不会切,代码块不一定 — 加 `page-break-inside: avoid` 缓解)
- ⚠️ shiki 代码块底色 / callout 背景色:默认浏览器 print 会忽略 background-color(为省墨),需让用户在 print 对话框里手动勾"打印背景图形"。或我们用 CSS `print-color-adjust: exact` 强制保留(方案二,推荐)。

### 需求 #3 — DOCX 路线:`@turbodocx/html-to-docx` + Mermaid SVG → PNG

**库选型**:`@turbodocx/html-to-docx`(2026-02 仍活跃维护,支持 data URL,改进 CJK)
- 比当前最热门的 `html-docx-js`(已停更 + 不支持 data URL)更好,具体调研见 §6
- 体积 ~180 KB

**实现**:
```ts
// 高层逻辑
const handleExportDocx = async () => {
  // 1. 拿到 viewer 渲染的 DOM 节点(.markdown-body 或类似)
  const node = document.querySelector('[data-context="file-viewer"] .markdown-body')

  // 2. 克隆 + 改造:Mermaid SVG → PNG(DOCX 不能渲染 SVG)
  const cloned = node.cloneNode(true)
  await convertSvgsToPng(cloned)

  // 3. 序列化 outerHTML + 串入完整 HTML 文档
  const html = wrapInHtmlShell(cloned.outerHTML)

  // 4. 转 docx
  const blob = await htmlToDocx(html, ...)

  // 5. Tauri save 对话框 → 写文件
  const filePath = await save({ filters: [{ name: 'Word', extensions: ['docx'] }], defaultPath: '<原 md 名>.docx' })
  if (!filePath) return // 用户取消
  await writeBinaryFile(filePath, await blob.arrayBuffer())

  // 6. toast 成功
}
```

**Mermaid SVG → PNG 转换**(关键!DOCX 不渲染 SVG):
```ts
async function convertSvgsToPng(root: Element) {
  for (const svg of root.querySelectorAll('svg')) {
    const dataUrl = await svgToPngDataUrl(svg, scale: 2) // 走 canvas.drawImage
    const img = document.createElement('img')
    img.src = dataUrl
    img.style.maxWidth = svg.clientWidth + 'px'
    svg.replaceWith(img)
  }
}
```

**已知效果限制**(对 user 透明,**比 PDF 明显逊**):
- ⚠️ Mermaid 流程图变成**位图 PNG**(失去可编辑 / 缩放清晰度,但能正常显示)
- ⚠️ shiki 代码块 syntax 高亮的颜色信息:库支持有限,可能丢成纯灰色/纯黑色 — **需 PoC 实测**
- ⚠️ Callout(GitHub Markdown Alert)的彩色边框 / 背景:库 CSS 支持有限,可能丢成普通 blockquote — **需 PoC 实测**
- ⚠️ TOC 内链:链接在 docx 里能否跳转待定 — **需 PoC 实测**
- ⚠️ 表格 / 列表 / 标题 / 加粗 / 斜体 / 行内代码 — **应当能保**(turbodocx 基础支持)
- ⚠️ 中文字体:turbodocx 改进过,**应当 OK**,需 PoC 实测

### 需求 #4 — Tauri 原生 save 对话框

**仅 DOCX 需要**(PDF 走系统 print 对话框,自带保存)。

**调用**(参考 `packages/desktop/src/index.tsx:113`):
```ts
import { save } from "@tauri-apps/plugin-dialog"
const filePath = await save({
  filters: [{ name: 'Word 文档', extensions: ['docx'] }],
  defaultPath: derivedDefaultPath, // <原 md 文件同目录>/<原文件名>.docx
  title: language.t("fileViewer.dialog.exportDocxTitle"),
})
```

**默认路径**:用 .md 文件的目录 + 原文件名 + `.docx` 后缀(便于用户直接保存到原位置;也可以另存)。

### 需求 #5 — i18n 接入(menu-i18n 框架)

**新加 6 个 i18n key**(三本 dict 都要加 — `en.ts` / `zh.ts` / `zht.ts`):

| key | en | zh(简) | zht(繁)|
|---|---|---|---|
| `fileViewer.menu.exportPdf` | Export as PDF | 导出为 PDF | 匯出為 PDF |
| `fileViewer.menu.exportDocx` | Export as Word | 导出为 Word | 匯出為 Word |
| `fileViewer.dialog.exportDocxTitle` | Save as Word document | 保存为 Word 文档 | 儲存為 Word 文件 |
| `fileViewer.toast.exportDocxSuccess` | Exported to Word | 已导出为 Word | 已匯出為 Word |
| `fileViewer.toast.exportDocxFail` | Export failed | 导出失败 | 匯出失敗 |
| `fileViewer.toast.exportPdfHint` | System print dialog will open. Choose "Save as PDF". | 即将弹出系统打印对话框,请选择"另存为 PDF"。 | 即將彈出系統列印對話框,請選擇「另存為 PDF」。 |

**命名风格**:沿用 menu-i18n 已建立的 `<scope>.<group>.<action>` 模式(参考 `fileTree.menu.rename` 等)。

---

## 3. 效果验收标准(P0 — 本笔成败核心)

> **user 强调"最关键的是转换后的效果"**。这条专门列详细。

### PDF 验收(window.print → 另存为 PDF)

| 内容 | 期望 | 容忍度 |
|---|---|---|
| 中文 | ✅ 完美保留(系统字体)| **0 容忍**,丢字 = 大 bug |
| Mermaid 流程图 | ✅ SVG 矢量保留,可缩放清晰 | 文字位置不偏即可 |
| 代码块 shiki 高亮 | ✅ 颜色 + 等宽字体保留 | ✅ 必须保留(否则代码块失去意义)|
| Callout 彩色边框/背景 | ✅ 颜色保留(`print-color-adjust: exact`)| 略偏色 OK,丢色不行 |
| 标题 / 加粗 / 斜体 / 表格 / 列表 | ✅ 完美 | 0 容忍 |
| 脚注 + TOC | ✅ 完美(浏览器原生渲染)| 0 容忍 |
| 长文档分页 | ⚠️ 浏览器自动分页 | 代码块切割可接受(边角 case)|
| 不需要的 UI(侧边栏/标签栏)| ❌ 不在 PDF 里 | 0 容忍(必须隐藏)|

### DOCX 验收(turbodocx + SVG→PNG)

| 内容 | 期望 | 容忍度 |
|---|---|---|
| 中文 | ✅ 必须保留 | **0 容忍** |
| 标题 / 加粗 / 斜体 / 列表 | ✅ Word 原生格式 | 0 容忍 |
| 表格 | ✅ Word 表格 | 边框样式可降级到默认 OK |
| 行内代码 | ✅ 等宽 + 灰底 | 灰底丢可接受 |
| 代码块 | ⚠️ 等宽字体保留;shiki 高亮**可能丢成纯黑** | 颜色丢可接受;字体丢不可接受 |
| Mermaid 流程图 | ✅ 转 PNG 后能正常显示 | **PoC 必测**;PNG 模糊不可接受 |
| Callout | ⚠️ 可能降级为普通 blockquote | 降级 OK,完全丢内容不行 |
| 脚注 | ⚠️ 可能变普通文本注释 | PoC 实测 |
| TOC 内链跳转 | ⚠️ docx 里点 TOC 跳转不一定能用 | 内容存在即可,跳转不能用可接受 |

### PoC 阶段(实施前必跑)

为防"做完才发现效果差,白干 200 行",**实施前先用 30 行 PoC 实测**:
1. 找一个**真实业务 .md**(含中文 + mermaid + callout + 代码块 + 脚注 + 表格,即 stress test)
2. 用 turbodocx 跑出 .docx,Word / WPS 打开看效果
3. 对照上面的"DOCX 验收"表逐项打分
4. 任何一项**0 容忍项**翻车 → spec 调方案再继续(可能换 docx 库 / 换路线)

---

## 4. 涉及文件清单

| 文件 | 改动性质 | 行数估 |
|---|---|---|
| `packages/app/src/pages/session/file-tabs.tsx` | 改 — 加导出菜单项 + 选区判定 + 触发函数 | +60 ~ +100 |
| `packages/app/src/utils/md-export-pdf.ts` | **新文件** — `window.print()` 触发器 + CSS @media print 规则 | +40 |
| `packages/app/src/utils/md-export-docx.ts` | **新文件** — DOCX 转换核心(turbodocx + SVG→PNG)| +80 ~ +150 |
| `packages/app/src/i18n/en.ts` / `zh.ts` / `zht.ts` | 改 — 加 6 个 key × 3 本 = 18 行 | +18 |
| `packages/app/package.json` | 改 — 加 1 dep(`@turbodocx/html-to-docx`)| +1 |
| `bun.lock` | 自动 | 自动 |
| 可能:`packages/ui/src/components/markdown.css` | 改 — 加 `@media print` 规则 + `print-color-adjust: exact` | +10 ~ +20 |

**总估**:200-350 行(不含 lock 自动生成)。**Medium 规模**。

**0 上游侵入**(全是 fork-only 文件;`packages/ui/src/components/markdown.css` 已是 fork-only 改过的)。

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| turbodocx 实测中文 / mermaid PNG / 代码块效果差 | 中 | 大 | **PoC 阶段先验证,差则换库** |
| `window.print()` 在 Tauri webview 行为异常 | 低 | 中 | 已知 Tauri Wry/WebView2 都支持原生 print;PoC 实测 |
| user 实际看到 print 对话框时不知道怎么选"PDF" | 中 | 小 | 加 toast 提示"请选择'另存为 PDF'" |
| 大文档(50+ 页)导出慢 / OOM | 低 | 小 | DOCX 库内存式;真大文档 user 可能要分批导,v1 不优化 |
| Word / WPS / Google Docs 打开 docx 渲染差异 | 中 | 中 | 以 **Word for Mac + WPS macOS** 两个为主验证(user 实际用)|
| Mermaid 在 viewer 里渲染要时间,导出时可能还没渲染完 | 低 | 中 | 导出前等 mermaid render 完成(查 mermaid API 是否暴露 ready promise)|

---

## 6. 决议汇总

| Q | 决议 |
|---|---|
| Q1 触发位置 | viewer 内右键 |
| Q2 PDF 实现 | `window.print()` + 系统 print 对话框 → 用户另存为 PDF(0 库 + CJK 完美 + mermaid 完美)|
| Q3 DOCX 实现 | `@turbodocx/html-to-docx` + Mermaid SVG → PNG 中间转换 |
| Q4 保存对话框 | DOCX 用 Tauri `save()`;PDF 走系统 print 对话框 |
| Q5 多选批量 | v1 单文件,多选 v2 |
| Q6 i18n | 走 menu-i18n 框架,6 个 key 三本 dict |
| UX 显示规则 | 选了文字 → 原菜单(复制/加聊天);没选文字 → 导出菜单 |

---

## 7. 不在本笔范围(follow-up backlog)

- 多选批量导出(v2)
- 选中文字 → 只导出选中段
- 自定义 PDF 模板 / 页眉页脚 / 水印
- Markdown → ePub / RTF / 其他格式
- Word 模板自定义(目前用库默认样式)
- 导出后自动打开生成的 PDF / DOCX

---

## 9. PoC 后实施细节修订(2026-05-05,只补不改)

> spec 锁版 + PoC 阶段实测后发现:**`@turbodocx/html-to-docx` 代码块视觉根本问题不可解决**(行间距巨大 / 无 syntax 高亮 / 字体非等宽),换库决议见下。本节作为 §2 需求 #3 的补充,**不改原 §2 内容**,以本节为最新实施依据。

### 9.1 DOCX 路线换库

| 维度 | 原 spec(`@turbodocx/html-to-docx`)| **修订(`@jinzhongjia/markdown-docx@1.0.4`)** |
|---|---|---|
| 输入 | HTML 字符串(viewer 渲染好的 DOM serialize)| **markdown 原文 string**(库内部 marked + docx 库构造)|
| 代码块视觉 | ⭐⭐(无 syntax 高亮,字体非等宽,行间距巨大)| **⭐⭐⭐⭐**(Consolas + 灰底 + syntax 高亮 + 紧凑行距 + 整框边线)|
| 中文 | ✅ | ✅ |
| 表格 / 列表 / 引用块 | ✅ | ✅(更佳)|
| Mermaid SVG → PNG 转换 | 必须做 | **不需要做** — 库不渲染 mermaid,直接出原 markdown 代码 fenced block(用户拿到 docx 时 mermaid 是 mermaid 源码块,可读不可视)|
| 任务列表 ☑ | ❌ | ✅ |
| 包体积 | ~180 KB | ~120 KB |
| 维护活跃度 | 中 | 活跃 |

### 9.2 关键 monkey-patch(必须)

```ts
import { styles } from '@jinzhongjia/markdown-docx'
// 库 default 把代码块每段的 between 边框设成跟 top 一样,导致段间画线;改 none
styles.markdown.code.paragraph.border.between = { style: 'none', size: 0 }
```

### 9.3 已知遗留(对 user 透明)

**代码块空行 paragraph 两侧仍出现横线** — 库内部把空行当独立段落处理,top/bottom border 仍渲染。`between=none` 解决了真代码行之间的横线,**但空行段两侧的 top/bottom 还在**。

- **触发场景**:代码块里有空行(分段) — 看起来像 import 之后空一行,然后 function;空行两侧出现横线把代码切成块
- **为什么不在本笔解决**:fork 库改空行处理逻辑投入大,换库要重测,**投入产出比低**
- **接受**:v1 出货带此遗留,user 验收时会看到
- **记录**:已入需求池 `OPENCODE-PLAN/DeskFox.Ai 需求池.md` 第 15 项,等触发条件(大量反馈 / 换库时机)再处理

### 9.4 Mermaid 处理简化

- 原 spec 计划 SVG → PNG 中间转换 → docx 嵌图 — **删除**
- markdown-docx 不渲染 mermaid,直接输出 fenced code block(```mermaid)
- 用户拿到 docx 看到 mermaid 源码块(等同纯文本),想看图回 viewer 看
- **接受**:DOCX 不带 mermaid 图,PDF(走 print)仍带

### 9.5 规模重估

| 段 | 原估 | **修订估** |
|---|---|---|
| viewer 右键菜单 + 选区判定 | ~60-100 | ~50 |
| PDF helper(window.print + CSS @media print)| ~40 | ~30 |
| DOCX helper(turbodocx 转换 + Mermaid SVG→PNG + 错误处理)| ~80-150 | **~25**(直接调 markdown-docx + 1 行 patch + save dialog)|
| i18n 6 key × 3 dict | ~18 | ~18 |
| 1 dep 加到 package.json | ~1 | ~1 |
| `@media print` CSS 规则 | ~10-20 | ~10-20 |
| **总** | **200-350 行** | **~130 行** |

**Medium → Tiny-Medium 边缘**(单一主题 + ~130 行,docs 三文档全要;不缩规范层级)

---

## 8. 二轮决议(2026-05-05 锁版)

| # | 问题 | 决议 |
|---|---|---|
| 1 | PoC 是否作为强制前置 | **强制** — 实施前先 30 行 PoC 实测 turbodocx + Mermaid SVG→PNG,效果差则换库 / 调方案再续 |
| 2 | DOCX 已知效果损失(shiki 颜色 / Callout 降级 / TOC 内链不一定跳)接受吗 | **接受** — docx 协议本身限制,容忍即可 v1 落地;前提是基础元素(中文 / 标题 / 加粗 / 表格 / 列表)0 容忍 |
| 3 | PDF 导出前 toast 提示"请选择'另存为 PDF'" 多余吗 | **保留** — 用户首次用可能不知道选哪个,一句话提示无负担 |

**spec 锁版,进入 PoC 阶段(§3 末"PoC 阶段"段)。**
