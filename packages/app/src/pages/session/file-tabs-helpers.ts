// FORK: file-tabs.tsx 的纯函数 helper 拆分到独立文件 — 便于 unit 测试 2026-05-07
//
// 原 file-tabs.tsx ~1668 行 + 上游 SolidJS / kobalte import 链路在 happydom 下
// 抛 "Client-only API called on the server side" — 测试单纯 helper 时被牵连。
// 拆到独立文件后,helper 测试 0 SolidJS 依赖,稳定可跑。
//
// file-tabs.tsx 通过 re-export 保持对外 API 不变。

export type MediaKind = "audio" | "video"

// audio 元素分支:纯音频容器
const AUDIO_MIME_FALLBACKS: Record<string, string[]> = {
  ".mp3": ["audio/mpeg"],
  ".m4a": ["audio/mp4", "audio/x-m4a", "audio/aac"],
  ".wav": ["audio/wav", "audio/wave", "audio/x-wav"],
  ".ogg": ["audio/ogg"],
  ".aac": ["audio/aac", "audio/mp4"],
  ".flac": ["audio/flac", "audio/x-flac"],
  ".opus": ["audio/opus", "audio/ogg"],
}

// video 元素分支
const VIDEO_MIME_FALLBACKS: Record<string, string[]> = {
  ".mp4": ["video/mp4"],
  ".m4v": ["video/mp4"],
  ".mov": ["video/quicktime", "video/mp4"],
  ".webm": ["video/webm"],
  ".mkv": ["video/x-matroska", "video/mp4"],
  ".avi": ["video/x-msvideo", "video/avi"],
}

// WebView2 内置播放器解不出的扩展
const UNSUPPORTED_MEDIA_EXTS = new Set([".m4a"])

export function isMarkdownPath(p: string | undefined): boolean {
  if (!p) return false
  const lower = p.toLowerCase()
  return lower.endsWith(".md") || lower.endsWith(".markdown")
}

// FORK: HTML 预览支持 2026-05-05
export function isHtmlPath(p: string | undefined): boolean {
  if (!p) return false
  const lower = p.toLowerCase()
  return lower.endsWith(".html") || lower.endsWith(".htm")
}

// 文件路径父目录(forward slash;支持 Windows 反斜杠)
export function pathDirname(p: string): string {
  const fwd = p.replace(/\\/g, "/")
  const idx = fwd.lastIndexOf("/")
  return idx >= 0 ? fwd.slice(0, idx) : ""
}

export function isUnsupportedMedia(p: string | undefined): boolean {
  if (!p) return false
  const lower = p.toLowerCase()
  for (const ext of UNSUPPORTED_MEDIA_EXTS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

export function mediaKindFromPath(p: string | undefined): { kind: MediaKind; mimes: string[] } | null {
  if (!p) return null
  const lower = p.toLowerCase()
  for (const ext in VIDEO_MIME_FALLBACKS) {
    if (lower.endsWith(ext)) return { kind: "video", mimes: VIDEO_MIME_FALLBACKS[ext]! }
  }
  for (const ext in AUDIO_MIME_FALLBACKS) {
    if (lower.endsWith(ext)) return { kind: "audio", mimes: AUDIO_MIME_FALLBACKS[ext]! }
  }
  return null
}

export function rangeAt(source: string, offset: number, len: number) {
  const before = source.slice(0, offset)
  const inner = source.slice(offset, offset + len)
  const start = (before.match(/\n/g)?.length ?? 0) + 1
  const end = start + (inner.match(/\n/g)?.length ?? 0)
  return { start, end }
}

// 构建归一化空白后的字符串 + 原 offset 映射,用于宽松匹配。
export function normalizeWithMap(s: string): { text: string; back: number[] } {
  const back: number[] = []
  let out = ""
  let prevSpace = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      if (!prevSpace && out.length > 0) {
        out += " "
        back.push(i)
      }
      prevSpace = true
    } else {
      out += c!
      back.push(i)
      prevSpace = false
    }
  }
  return { text: out, back }
}

// 把选中文字映射回源码行号区间(1-based)。
export function findLineRange(source: string, needle: string): { start: number; end: number } | null {
  if (!source || !needle) return null
  const trimmed = needle.trim()
  if (!trimmed) return null

  const idx = source.indexOf(trimmed)
  if (idx >= 0) return rangeAt(source, idx, trimmed.length)

  const { text: nSource, back } = normalizeWithMap(source)
  const nNeedle = trimmed.replace(/[\s]+/g, " ")
  const nIdx = nSource.indexOf(nNeedle)
  if (nIdx < 0 || nIdx >= back.length) return null

  const srcStart = back[nIdx]!
  const endNIdx = Math.min(nIdx + nNeedle.length, back.length - 1)
  const srcEnd = back[endNIdx] ?? source.length
  return rangeAt(source, srcStart, Math.max(1, srcEnd - srcStart))
}

export function truncatePreview(text: string, max = 500): string {
  const collapsed = text.replace(/\s+/g, " ").trim()
  if (collapsed.length <= max) return collapsed
  return collapsed.slice(0, max) + "…"
}
