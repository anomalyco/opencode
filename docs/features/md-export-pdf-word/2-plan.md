---
feat-id: md-export-pdf-word
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# md-export-pdf-word — Plan

> 2026-05-05。基于 1-spec.md(锁版 + §9 PoC 后修订)。
> 4 笔 commit,每笔可独立 revert。**总规模 ~130 行**(比原 spec §3 估的 200-350 大幅缩水,因 markdown-docx 替我们做了大量 walker 工作)。

---

## 实施顺序

```
#1 加 dep 到 package.json + monkey-patch styles  ← 基础设施
↓
#2 加 i18n 6 个 key × 3 dict                    ← 文案就位
↓
#3 PDF helper(window.print + @media print CSS)  ← 简单
↓
#4 DOCX helper(markdown-docx + Tauri save)+ viewer 右键菜单接入  ← 主菜
↓
build → user 实测 → changelog → merge dev
```

依赖链:#4 接入菜单需要 #3 的 PDF helper + #2 的 i18n 文案 + #1 的 dep。所以顺序不能错。

---

## commit #1 — 加 dep + monkey-patch

**Tiny,~5 行。**

### 关键改动

1. `packages/app/package.json` — 加 1 dep:`"@jinzhongjia/markdown-docx": "^1.0.4"`
2. `bun install` 自动更新 `bun.lock`
3. **不在本笔做 monkey-patch** — 留给 #4 的 docx helper 引用时一次性加

### commit message

```
chore(deps): 加 @jinzhongjia/markdown-docx 用于 .md 导出 word [feat: md-export-pdf-word]
```

### 验证

- `bun run --cwd packages/app typecheck` 不挂

---

## commit #2 — i18n 6 个 key × 3 dict

**Tiny,~18 行。**

### 关键改动

3 文件各加 6 key(en.ts / zh.ts / zht.ts):

| key | en | zh | zht |
|---|---|---|---|
| `fileViewer.menu.exportPdf` | Export as PDF | 导出为 PDF | 匯出為 PDF |
| `fileViewer.menu.exportDocx` | Export as Word | 导出为 Word | 匯出為 Word |
| `fileViewer.dialog.exportDocxTitle` | Save as Word document | 保存为 Word 文档 | 儲存為 Word 文件 |
| `fileViewer.toast.exportDocxSuccess` | Exported to Word | 已导出为 Word | 已匯出為 Word |
| `fileViewer.toast.exportDocxFail` | Export failed | 导出失败 | 匯出失敗 |
| `fileViewer.toast.exportPdfHint` | Choose "Save as PDF" in the print dialog. | 即将弹出系统打印对话框,请选择"另存为 PDF"。 | 即將彈出系統列印對話框,請選擇「另存為 PDF」。 |

文件位置:`packages/app/src/i18n/en.ts` / `zh.ts` / `zht.ts` — 在已有 `fileViewer.*` 段(若有)或 `fileTree.*` 段附近追加。

### commit message

```
feat(i18n): 加 fileViewer.menu/dialog/toast 6 个 export 相关 key [feat: md-export-pdf-word]
```

### 验证

- typecheck 不挂(i18n key 类型自动同步)

---

## commit #3 — PDF helper(window.print + @media print)

**Tiny-Medium,~30 行 + ~15 行 CSS。**

### 关键改动

1. **新文件** `packages/app/src/utils/md-export-pdf.ts`(~25 行):
   ```ts
   import { showToast } from "@opencode-ai/ui/toast"

   export const exportMdAsPdf = (opts: { hintText: string }) => {
     showToast({ variant: "info", title: opts.hintText })
     // 等 toast 渲染 + 用户读完(~800ms),然后弹 print
     setTimeout(() => window.print(), 800)
   }
   ```

2. **新文件 / 改 `packages/ui/src/components/markdown.css`** — 加 `@media print` 规则(~15 行):
   ```css
   @media print {
     /* 隐藏不该进 PDF 的 UI(侧边栏 / 标签栏 / chrome) */
     [data-component="sidebar"],
     [data-component="filetree"],
     [data-component="header"],
     [data-component="status-bar"] { display: none !important; }

     /* 强制保留代码块 / callout 等的背景色(浏览器 print 默认省墨) */
     [data-context="file-viewer"] *,
     [data-context="file-viewer"] {
       print-color-adjust: exact !important;
       -webkit-print-color-adjust: exact !important;
     }

     /* 让 viewer 占满纸张宽度 */
     [data-context="file-viewer"] {
       width: 100% !important;
       max-width: none !important;
     }

     /* 代码块尽量不分页 */
     pre { page-break-inside: avoid; }
   }
   ```

> 注:`@media print` CSS 加哪个文件待 #4 验证。可能 `packages/ui/src/components/markdown.css` 是 fork-only(已改过),也可能要新建 `packages/app/src/styles/print.css`。

### commit message

```
feat(file-viewer): 加 .md 导出 PDF helper(走 window.print + @media print 隐藏 UI / 强制保留底色) [feat: md-export-pdf-word]
```

### 验证

- typecheck 不挂
- 手动:在 viewer 内点导出 PDF,弹 print 对话框,选"另存为 PDF",PDF 内容跟 viewer 视觉一致

---

## commit #4 — DOCX helper + viewer 右键菜单接入

**Medium,~75 行(主菜)。**

### 关键改动 1:**新文件** `packages/app/src/utils/md-export-docx.ts`(~35 行)

```ts
import markdownDocx, { Packer, styles } from "@jinzhongjia/markdown-docx"
import { save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@tauri-apps/plugin-fs"
import { showToast } from "@opencode-ai/ui/toast"

// FORK: monkey-patch 关代码块段间分隔线 2026-05-05
styles.markdown.code.paragraph.border.between = { style: "none", size: 0 }

export const exportMdAsDocx = async (opts: {
  markdownText: string
  defaultFileName: string  // 不带后缀,如 "untitled"
  i18n: { title: string; success: string; fail: string }
}) => {
  try {
    // 1. Tauri save 对话框
    const filePath = await save({
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
      defaultPath: `${opts.defaultFileName}.docx`,
      title: opts.i18n.title,
    })
    if (!filePath) return  // user 取消

    // 2. 转 docx
    const doc = await markdownDocx(opts.markdownText, {
      codeHighlight: { enabled: true, theme: "github-light" },
    })
    const buf = await Packer.toBuffer(doc)

    // 3. 写盘
    await writeFile(filePath, buf)

    showToast({ variant: "success", title: opts.i18n.success })
  } catch (e) {
    showToast({
      variant: "error",
      title: opts.i18n.fail,
      description: e instanceof Error ? e.message : String(e),
    })
  }
}
```

### 关键改动 2:viewer 右键菜单接入(`packages/app/src/pages/session/file-tabs.tsx`,~40 行改 + ~10 行 helper)

参考 1-spec §2 需求 #1(选了文字时显原菜单 / 没选时显导出菜单):

```tsx
// 在 handleSelectionContextMenu(file-tabs.tsx:722 附近)里
const onContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  const sel = window.getSelection()
  const hasSelection = sel && !sel.isCollapsed && sel.toString().length > 0

  if (hasSelection) {
    // 原 mdMenu 逻辑(复制 / 加聊天)
    showOriginalMdMenu(event)
  } else {
    // 新:导出菜单
    showExportMenu(event)
  }
}

// showExportMenu 实现:类似现有 mdMenu signal state,2 项菜单
const [exportMenu, setExportMenu] = createSignal<{ x: number; y: number } | null>(null)

const onExportPdf = () => {
  setExportMenu(null)
  exportMdAsPdf({ hintText: language.t("fileViewer.toast.exportPdfHint") })
}
const onExportDocx = async () => {
  setExportMenu(null)
  await exportMdAsDocx({
    markdownText: contents(),  // viewer 的 md 原文(file-tabs.tsx:369 contents memo)
    defaultFileName: basename(path()).replace(/\.(md|markdown)$/i, ""),
    i18n: {
      title: language.t("fileViewer.dialog.exportDocxTitle"),
      success: language.t("fileViewer.toast.exportDocxSuccess"),
      fail: language.t("fileViewer.toast.exportDocxFail"),
    },
  })
}

// JSX(类似现有 mdMenu 结构):
<Show when={exportMenu()}>
  {(menu) => (
    <div class="..." style={{ left: `${menu().x}px`, top: `${menu().y}px` }}>
      <button onClick={onExportPdf}>{language.t("fileViewer.menu.exportPdf")}</button>
      <button onClick={onExportDocx}>{language.t("fileViewer.menu.exportDocx")}</button>
    </div>
  )}
</Show>
```

> 待实施时确认现有 mdMenu 风格,本笔保持一致(包括 click outside 关闭逻辑、键盘 Esc 关闭)。

### commit message

```
feat(file-viewer): 接入右键导出 PDF / Word 菜单 + DOCX helper(markdown-docx + Tauri save) [feat: md-export-pdf-word]
```

### 验证

- typecheck 不挂
- 手动:viewer 内右键(没选文字)→ 弹"导出 PDF / 导出 Word"
- 选了文字右键 → 仍显原"复制 / 加聊天"
- 点导出 Word → 弹 Tauri save 对话框 → 选位置 → .docx 出来,Word 打开效果跟 PoC v9 一致
- 点导出 PDF → toast 提示 → print 对话框 → 选"另存为 PDF" → PDF 跟 viewer 视觉一致

---

## 测试构建

```bash
bash packages/branding/scripts/build-deskfox.sh -Env dev
```

完整 build(出 .app + .dmg)给 user 实测。

## user 自测清单

| # | 用例 | 期望 |
|---|---|---|
| 1 | viewer 看 .md,**没选文字**右键 | 弹"导出 PDF / 导出 Word"两项 |
| 2 | viewer 看 .md,**选了文字**右键 | 弹原"复制 / 加聊天"两项(本笔不动)|
| 3 | viewer 看 **非 .md** 文件(.html / .pdf / .py 等)右键 | 不出现导出菜单(只对 markdown 生效)|
| 4 | 导出 PDF | toast 提示 → 系统 print 对话框 → 选 PDF 保存 → 内容含 mermaid / shiki / 中文 / 表格,UI 不出现 |
| 5 | 导出 Word | save 对话框 → 选位置 → 成功 toast → Word 打开:Consolas + syntax 高亮 + 中文(代码块空行段两侧有横线属已知遗留)|
| 6 | 导出 Word 取消 | save 对话框点取消 → 无 toast / 无错误 |
| 7 | 导出后导出再次 | 两次都能成功(无 state 残留)|
| 8 | 大 .md(>1000 行)导出 Word | 时间合理(< 5 秒),内容完整 |

---

## 涉及文件汇总

| 文件 | 改动笔数 | 性质 | 行数估 |
|---|---|---|---|
| `packages/app/package.json` | #1 | fork-only | +1 |
| `bun.lock` | #1 | 自动 | +大量(transitive deps)|
| `packages/app/src/i18n/en.ts` | #2 | fork-only | +6 |
| `packages/app/src/i18n/zh.ts` | #2 | fork-only | +6 |
| `packages/app/src/i18n/zht.ts` | #2 | fork-only | +6 |
| `packages/app/src/utils/md-export-pdf.ts` | #3 | **新文件** fork-only | +25 |
| `packages/ui/src/components/markdown.css` 或新 print.css | #3 | fork-only | +15 |
| `packages/app/src/utils/md-export-docx.ts` | #4 | **新文件** fork-only | +35 |
| `packages/app/src/pages/session/file-tabs.tsx` | #4 | fork-only(file-tree-dnd / md-office-improvements 已 fork)| +50 / -0 |

**总:~145 行(含 18 行 i18n)**。**0 上游侵入**(全 fork-only / 新文件)。

---

## 风险与回退

| 风险 | 缓解 |
|---|---|
| `@jinzhongjia/markdown-docx` 在 Tauri webview 内行为异常 | 该库 declares browser entry,应当 OK;dev build 第一次 + #4 commit 后立即 user 实测 |
| `window.print()` 在 Tauri Wry 上行为异常 | 标准 Web API,Tauri 完全支持 |
| `@media print` CSS 选择器写错隐藏不该隐藏的 | 改前用 dev tools 模拟 print 视图(Cmd+Opt+I → ⋮ → More tools → Rendering → Emulate CSS media: print)|
| 大 .md 导出 OOM | markdown-docx 流式,~1k 行级 .md 应当稳;>1 万行 v1 不优化 |
| 代码块空行横线 | 已知遗留,接受(spec §9.3) |

每笔独立 commit,可单独 revert;整笔 revert merge commit。
