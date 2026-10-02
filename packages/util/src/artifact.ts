/** How the app shows a file, from its extension. */
export type ArtifactKind =
  | "image"
  | "svg"
  | "audio"
  | "video"
  | "pdf"
  | "html"
  | "markdown"
  | "mermaid"
  | "table"
  | "font"
  | "text"

const mimes = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  ["tif", "image/tiff"],
  ["tiff", "image/tiff"],
  ["heic", "image/heic"],
  ["svg", "image/svg+xml"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["opus", "audio/ogg"],
  ["weba", "audio/webm"],
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["webm", "video/webm"],
  ["mov", "video/quicktime"],
  ["ogv", "video/ogg"],
  ["mkv", "video/x-matroska"],
  ["pdf", "application/pdf"],
  ["html", "text/html"],
  ["htm", "text/html"],
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["mdx", "text/markdown"],
  ["mmd", "text/vnd.mermaid"],
  ["mermaid", "text/vnd.mermaid"],
  ["csv", "text/csv"],
  ["tsv", "text/tab-separated-values"],
  ["ttf", "font/ttf"],
  ["otf", "font/otf"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
])

function artifactExtension(path: string) {
  const name = path.split(/[\\/]/).pop() ?? ""
  const index = name.lastIndexOf(".")
  if (index <= 0) return ""
  return name.slice(index + 1).toLowerCase()
}

export function artifactMime(path: string) {
  return mimes.get(artifactExtension(path))
}

export function artifactKind(path: string): ArtifactKind {
  const mime = artifactMime(path)
  if (!mime) return "text"
  if (mime === "image/svg+xml") return "svg"
  if (mime === "application/pdf") return "pdf"
  if (mime === "text/html") return "html"
  if (mime === "text/markdown") return "markdown"
  if (mime === "text/vnd.mermaid") return "mermaid"
  if (mime === "text/csv" || mime === "text/tab-separated-values") return "table"
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("font/")) return "font"
  return "video"
}
