// [fork-only] reply-actions — feishu-bridge-light 纯函数 helper
// [feat: feishu-bridge-light] 2026-05-23
//
// 收纳本 feat 的可单测纯函数,跟 message-pipeline.ts 的 IO/状态隔离:
//   - stripMentions — 从 text 里 strip 飞书 @mention 标记(/new 检测前用)
//   - parseAttachMarkers — AI reply 里 [ATTACH:path] marker(Phase 2)
//   - classifyAttachment — 扩展名 → image/file/reject 分流 + 路径白名单校验(Phase 2)
//   - (后续 Phase 3 加)parseCreateGroupMarkers — AI reply 里 [CREATE_GROUP:name] marker

import { homedir } from "node:os"
import { extname, isAbsolute, join, resolve, sep } from "node:path"

/** ImMessageEvent.mentions 的子集 — 只用到 key 字段,decouple wss-client 直接依赖 */
export interface MentionRef {
  key: string
  name: string
  openId?: string
}

/**
 * 从 text 里把所有 @mention 标记 strip 掉,然后 trim。
 *
 * 飞书 IM 在 text content 里把 `@bot` 渲染成形如 `@_user_1 ...` 的占位,对应
 * `mentions[].key === "_user_1"`。`/new` 在群里以 `@bot /new` 发出时,需先 strip mention
 * 才能识别字面值。私聊里没 @ 标记,strip 后等于 trim。
 *
 * key 里理论上不含 regex 特殊字符(飞书形态 `_user_N`),但防御性转义保险。
 */
export function stripMentions(text: string, mentions: ReadonlyArray<MentionRef>): string {
  let out = text
  for (const m of mentions) {
    const escaped = m.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    out = out.replace(new RegExp(`@${escaped}\\s*`, "g"), "")
  }
  return out.trim()
}

// ============================================================
// [ATTACH:path] marker (Phase 2)
// ============================================================

/** 飞书 file.create 支持的 file_type 枚举 — 其它扩展名走 stream 兜底 */
export type LarkFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream"

/** 默认 workspace 根 — 所有 ATTACH 路径必须在此子树内才允许上传 */
export const FEISHU_WORKSPACE_ROOT = join(homedir(), ".opencode", "feishu-workspace")

/** 走 image.create 的扩展名(返回 image_key,≤10MB) */
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".ico"])

/** 扩展名 → 飞书 file_type SDK 枚举(未列扩展名走 stream 兜底) */
const FILE_TYPE_MAP: Record<string, LarkFileType> = {
  ".pdf": "pdf",
  ".doc": "doc",
  ".xls": "xls",
  ".ppt": "ppt",
  ".mp4": "mp4",
  ".opus": "opus",
}

const ATTACH_MARKER_RE = /\[ATTACH:([^\]]+)\]/g
const CREATE_GROUP_MARKER_RE = /\[CREATE_GROUP:([^\]]+)\]/g

export interface ParsedMarkers {
  paths: string[]
  cleanText: string
}

export interface ParsedGroupMarkers {
  names: string[]
  cleanText: string
}

/**
 * 解析 reply 里所有 `[ATTACH:path]` marker。
 *
 * - paths:按出现顺序,trim 后的路径串(可包含相对路径 / 越界路径 — 校验交给 classifyAttachment)
 * - cleanText:strip 所有 marker 后的文本;残留行尾空格 + 多余空行做基础清理后 trim
 */
export function parseAttachMarkers(text: string): ParsedMarkers {
  const paths: string[] = []
  for (const m of text.matchAll(ATTACH_MARKER_RE)) {
    const p = m[1]?.trim()
    if (p) paths.push(p)
  }
  const cleanText = stripMarkers(text, ATTACH_MARKER_RE)
  return { paths, cleanText }
}

/**
 * 解析 reply 里所有 `[CREATE_GROUP:name]` marker(Phase 3 自动建群)。
 *
 * - names:按出现顺序,trim 后的群名(空 marker 跳过)
 * - cleanText:strip 后清行尾空格 + 收敛多余空行
 *
 * 跟 parseAttachMarkers 共享 stripMarkers 帮手;两类 marker 独立解析,
 * 调用方负责按 marker 类型路由处理。
 */
export function parseCreateGroupMarkers(text: string): ParsedGroupMarkers {
  const names: string[] = []
  for (const m of text.matchAll(CREATE_GROUP_MARKER_RE)) {
    const n = m[1]?.trim()
    if (n) names.push(n)
  }
  const cleanText = stripMarkers(text, CREATE_GROUP_MARKER_RE)
  return { names, cleanText }
}

/** strip 一种 marker + 清行尾空格 + 收敛空行 + trim */
function stripMarkers(text: string, re: RegExp): string {
  return text
    .replace(re, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export type AttachClassification =
  | { kind: "image" }
  | { kind: "file"; fileType: LarkFileType }
  | { kind: "reject"; reason: string }

/**
 * 给一个路径分类:image / file(含 fileType)/ reject(含原因)。
 *
 * 安全约束(防 LLM 把 `/etc/passwd` 发出去):
 * - 必须是绝对路径
 * - resolve 后必须在 workspaceRoot 子树内
 *
 * @param path 来自 LLM reply 的 `[ATTACH:xxx]` 解析串
 * @param workspaceRoot 默认 `~/.opencode/feishu-workspace`,单测可覆盖
 */
export function classifyAttachment(
  path: string,
  workspaceRoot: string = FEISHU_WORKSPACE_ROOT,
): AttachClassification {
  if (!isAbsolute(path)) {
    return { kind: "reject", reason: "非绝对路径" }
  }
  const norm = resolve(path)
  const rootWithSep = workspaceRoot.endsWith(sep) ? workspaceRoot : workspaceRoot + sep
  if (norm !== workspaceRoot && !norm.startsWith(rootWithSep)) {
    return { kind: "reject", reason: `在 workspace 外(${workspaceRoot})` }
  }
  const ext = extname(norm).toLowerCase()
  if (IMAGE_EXTS.has(ext)) {
    return { kind: "image" }
  }
  return { kind: "file", fileType: FILE_TYPE_MAP[ext] ?? "stream" }
}
