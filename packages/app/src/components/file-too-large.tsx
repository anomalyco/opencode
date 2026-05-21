// FORK: 大文件预览统一防护 — UX 兜底组件
// [feat: large-file-preview-guard] 2026-05-21
//
// 当 file-tabs.tsx renderFile 看到 state.tooLarge 时渲染本组件,显示文件信息 + 可操作按钮。
// 不放在 file-tabs.tsx 内是为了 ① 减小巨石 file-tabs.tsx 文件 ② 复用给未来其他 viewer 入口

import { Component } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import { showToast } from "@opencode-ai/ui/toast"
import { formatSize, type SizeCategory } from "@/utils/file-size-guard"

type FileTooLargeProps = {
  /** 文件相对路径(项目根目录相对) */
  path: string
  /** 项目根目录绝对路径 */
  root: string
  /** 实际文件 size(bytes) */
  size: number
  /** 触发的分类(决定阈值)*/
  category: string
  /** 该分类的 size limit(bytes) */
  limit: number
}

const CATEGORY_LABEL: Record<string, string> = {
  text: "文本/代码",
  markdown: "Markdown",
  media: "音视频/图片",
  office: "Office 文档",
  html: "HTML",
  binary: "二进制",
  default: "文件",
}

function parentDir(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/")
  const idx = normalized.lastIndexOf("/")
  if (idx <= 0) return normalized
  return normalized.slice(0, idx)
}

export const FileTooLarge: Component<FileTooLargeProps> = (props) => {
  const absPath = () => `${props.root}/${props.path}`.replace(/\\/g, "/")

  const openInSystem = async () => {
    try {
      await invoke("open_path", { path: absPath(), appName: null })
    } catch (e) {
      showToast({ variant: "error", title: `打开失败: ${e}` })
    }
  }

  const openParent = async () => {
    try {
      await invoke("open_path", { path: parentDir(absPath()), appName: null })
    } catch (e) {
      showToast({ variant: "error", title: `打开文件夹失败: ${e}` })
    }
  }

  return (
    <div class="flex flex-col items-center justify-center px-6 py-8 gap-3 h-full">
      <div class="text-text-base text-sm font-medium">文件过大,跳过预览</div>
      <div class="text-text-weak text-xs text-center max-w-xl break-all">
        {props.path}
      </div>
      <div class="text-text-weak text-xs text-center">
        类型 {CATEGORY_LABEL[props.category] ?? props.category} · 大小{" "}
        <span class="text-text-base">{formatSize(props.size)}</span>
        {Number.isFinite(props.limit) ? (
          <>
            {" "}· 阈值 <span class="text-text-base">{formatSize(props.limit)}</span>
          </>
        ) : null}
      </div>
      <div class="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={openInSystem}
          class="text-xs px-3 py-1.5 rounded border border-border-base hover:bg-surface-base-hover"
          title="用系统默认应用打开此文件"
        >
          用本机软件打开
        </button>
        <button
          type="button"
          onClick={openParent}
          class="text-xs px-3 py-1.5 rounded border border-border-base hover:bg-surface-base-hover"
          title="打开文件所在的文件夹"
        >
          打开所在文件夹
        </button>
      </div>
    </div>
  )
}

// 为了避免未使用 import 警告(将来 UX 可能用到分类显示)
export type { SizeCategory }
