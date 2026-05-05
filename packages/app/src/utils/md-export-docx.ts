// [fork-only] .md 导出 Word(docx)— @jinzhongjia/markdown-docx + 走 platform 抽象
// [feat: md-export-pdf-word] 2026-05-05
//
// 选 @jinzhongjia/markdown-docx@1.0.4 的理由:
// - PoC 实测 v9 综合最优:Consolas + 灰底 + syntax 高亮 + 紧凑行距 + 整框边线 + 中文 — 全过
// - 比 turbodocx 强(后者代码块视觉根本问题不可解决)
// - 库内置 200+ 语言 syntax 高亮(默认 github-light 主题)
// - 库基于成熟的 docx@9.x(5k stars 主流)
//
// 已知遗留(对 user 透明,已记需求池):
// - 代码块**空行段两侧仍有横线分隔**(库内部把空行当独立段落,top/bottom border 仍渲染)
// - between=none monkey-patch 解决了真代码行之间的横线,但空行段仍有

import markdownDocx, { Packer, styles } from "@jinzhongjia/markdown-docx"
import { invoke } from "@tauri-apps/api/core"
import { showToast } from "@opencode-ai/ui/toast"

// FORK: monkey-patch 关代码块段间分隔线 — 库 default 把 between 边框设成跟 top 一样,
// 导致每段画线;改 none 让段间只是普通行距 2026-05-05
// 用 any cast 绕过库类型 readonly
;(styles as any).markdown.code.paragraph.border.between = { style: "none", size: 0 }

export type ExportDocxI18n = {
  /** save 对话框标题 */
  title: string
  /** 成功 toast 文案 */
  success: string
  /** 失败 toast 文案 */
  fail: string
}

/** save 对话框函数签名,与 packages/app/src/context/platform.tsx saveFilePickerDialog 一致 */
export type SaveFilePickerFn = (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>

/** Buffer → base64(浏览器侧,Buffer 在 Tauri webview 是 Uint8Array)*/
function bufferToBase64(buf: Uint8Array | Buffer): string {
  let binary = ""
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** 把 markdown 原文导出为 .docx
 *
 * 调用方负责传入 platform.saveFilePickerDialog(viewer 菜单 callback 那一层注入)
 * 这样 helper 不直接依赖 @tauri-apps/plugin-dialog(packages/app 没装该 plugin)
 */
export const exportMdAsDocx = async (opts: {
  /** markdown 原文(viewer 渲染的源) */
  markdownText: string
  /** save 对话框默认文件名(不带后缀,如原 .md 文件名去掉 .md)*/
  defaultFileName: string
  /** Tauri save 对话框函数(调用方注入,通常是 platform.saveFilePickerDialog) */
  saveDialog: SaveFilePickerFn
  i18n: ExportDocxI18n
}) => {
  let filePath: string | null = null
  try {
    // 1. 系统 save 对话框(经 platform 抽象)
    filePath = await opts.saveDialog({
      defaultPath: `${opts.defaultFileName}.docx`,
      title: opts.i18n.title,
    })
    if (!filePath) return // user 取消,静默退出

    // 2. markdown → docx(库内部 marked + docx@9.x 构造,带 syntax 高亮)
    const doc = await markdownDocx(opts.markdownText, {
      codeHighlight: {
        enabled: true,
        theme: "github-light", // 浅色主题更适合 Word 打印
      },
    })

    // 3. 序列化 + 写盘(用 fork-only Tauri command,base64 传输绕开二进制 IPC 限制)
    const buf = await Packer.toBuffer(doc)
    const base64 = bufferToBase64(buf as Uint8Array | Buffer)
    await invoke("write_binary_file_absolute_base64", { path: filePath, base64Content: base64 })

    showToast({ variant: "success", title: opts.i18n.success })
  } catch (e) {
    showToast({
      variant: "error",
      title: opts.i18n.fail,
      description: e instanceof Error ? e.message : String(e),
    })
  }
}
