// FORK: 本地资源 protocol(localasset://) URL 构造 + 路径解析工具 2026-05-05
// 配合 packages/desktop/src-tauri/src/local_asset.rs 的 Rust handler 使用。
// URL 形态:
//   Windows / Android:  http://localasset.localhost/<base64url-root>/<rel-path>
//   macOS / Linux / iOS: localasset://localhost/<base64url-root>/<rel-path>
// 跨 .md 图、音视频、HTML 预览 iframe 三类资源共用一套。

const SCHEME = "localasset"

const BASE_URL = (() => {
  if (typeof navigator === "undefined") return `${SCHEME}://localhost`
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("windows") || ua.includes("android")) {
    return `http://${SCHEME}.localhost`
  }
  return `${SCHEME}://localhost`
})()

function base64UrlEncode(s: string): string {
  const utf8 = new TextEncoder().encode(s)
  let bin = ""
  for (let i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i])
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/")
}

function isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:\//.test(p)
}

function joinAbs(baseDir: string, rel: string): string {
  if (isAbsolute(rel)) return rel
  const cleaned = baseDir.replace(/\/+$/, "")
  return cleaned + "/" + rel
}

/** 规范化路径:解 . / ..,合并多重 / */
function normPath(p: string): string {
  const m = /^([a-zA-Z]:)/.exec(p)
  const prefix = m ? m[1] : ""
  const rest = m ? p.slice(prefix.length) : p
  const segs = rest.split("/")
  const out: string[] = []
  for (const seg of segs) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      if (out.length > 0) out.pop()
      continue
    }
    out.push(seg)
  }
  return prefix + "/" + out.join("/")
}

/** baseDir(绝对) + rel(相对或绝对)→ 规范化的绝对路径(forward slash) */
export function resolveAbsolute(baseDir: string, rel: string): string {
  return normPath(joinAbs(normalizeSlashes(baseDir), normalizeSlashes(rel)))
}

/** 构造 localasset URL。abs 必须在 root 内(越权由 Rust handler 终审,前端 best-effort) */
export function localAssetUrl(root: string, abs: string): string {
  const normRoot = normalizeSlashes(root).replace(/\/+$/, "")
  const normAbs = normalizeSlashes(abs)

  let rel: string
  if (normAbs.startsWith(normRoot + "/")) {
    rel = normAbs.slice(normRoot.length + 1)
  } else if (normAbs === normRoot) {
    rel = ""
  } else {
    // abs 不在 root 下 — 仍构造 URL(Rust handler starts_with 校验会拒绝)
    rel = normAbs.replace(/^\/+/, "")
  }

  const encodedSegs = rel.split("/").map(encodeURIComponent).join("/")
  const encodedRoot = base64UrlEncode(normRoot)
  return `${BASE_URL}/${encodedRoot}/${encodedSegs}`
}

/** 改写一个 src(可能是相对 / 绝对 / 外链)为 localasset URL;
 *  外链 / data / blob / file / anchor / 已是 localasset 等返 null(不改写)。 */
export function rewriteAssetSrc(root: string, baseDir: string, src: string): string | null {
  if (!src) return null
  const trimmed = src.trim()
  if (!trimmed) return null
  // 跳过外部 / 内部已知 URL 模式
  if (/^(https?|data|blob|localasset|file|tauri|asset|mailto|javascript):/i.test(trimmed)) return null
  if (trimmed.startsWith("//")) return null // protocol-relative
  if (trimmed.startsWith("#")) return null // anchor link

  // FORK fix 2026-05-05:marked 输出的 <img src=""> 对非 ASCII 文件名(如 ./架构图.png)
  // 已经做了一次 percent-encode → "./%E6%9E%B6%E6%9E%84%E5%9B%BE.png"。
  // 我们要把它解码回 raw UTF-8 字符串,再 join 路径,否则:
  //   resolveAbsolute 拼出 "C:/.../%E6...png"(literal % 字符)
  //   localAssetUrl 又 encodeURIComponent → "%25E6..."(双重编码)
  //   Rust 单次 decode 后路径里还有 %E6 字面量 → canonicalize 失败 → 404
  let decoded = trimmed
  try {
    decoded = decodeURIComponent(trimmed)
  } catch {
    // 解码失败(比如 src 里有孤立 % 而非合法转义)→ 保留原文
  }

  const abs = resolveAbsolute(baseDir, decoded)
  return localAssetUrl(root, abs)
}
