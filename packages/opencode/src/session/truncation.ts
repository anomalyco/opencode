export namespace Truncate {
  export const MAX_LINES = 2000
  export const MAX_BYTES = 50 * 1024

  export interface Result {
    content: string
    truncated: boolean
  }

  export interface Options {
    maxLines?: number
    maxBytes?: number
    direction?: "head" | "tail"
  }

  export function output(text: string, options: Options = {}): Result {
    const maxLines = options.maxLines ?? MAX_LINES
    const maxBytes = options.maxBytes ?? MAX_BYTES
    const direction = options.direction ?? "head"
    const lines = text.split("\n")
    const totalBytes = Buffer.byteLength(text, "utf-8")

    if (lines.length <= maxLines && totalBytes <= maxBytes) {
      return { content: text, truncated: false }
    }

    const out: string[] = []
    var i = 0
    var bytes = 0
    var hitBytes = false

    if (direction === "head") {
      for (i = 0; i < lines.length && i < maxLines; i++) {
        const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.push(lines[i])
        bytes += size
      }
      const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
      const unit = hitBytes ? "chars" : "lines"
      return { content: `${out.join("\n")}\n\n...${removed} ${unit} truncated...`, truncated: true }
    }

    for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
      const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
      if (bytes + size > maxBytes) {
        hitBytes = true
        break
      }
      out.unshift(lines[i])
      bytes += size
    }
    const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
    const unit = hitBytes ? "chars" : "lines"
    return { content: `...${removed} ${unit} truncated...\n\n${out.join("\n")}`, truncated: true }
  }
}
