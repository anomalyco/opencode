export namespace Locale {
  export function titlecase(str: string) {
    return str.replace(/\b\w/g, (c) => c.toUpperCase())
  }

  export function time(input: number) {
    const date = new Date(input)
    return date.toLocaleTimeString()
  }

  export function number(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M"
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K"
    }
    return num.toString()
  }

  export function truncate(str: string, len: number): string {
    if (str.length <= len) return str
    return str.slice(0, len - 1) + "…"
  }

  export function truncateMiddle(str: string, maxLength: number = 35): string {
    if (str.length <= maxLength) return str

    const ellipsis = "…"
    const keepStart = Math.ceil((maxLength - ellipsis.length) / 2)
    const keepEnd = Math.floor((maxLength - ellipsis.length) / 2)

    return str.slice(0, keepStart) + ellipsis + str.slice(-keepEnd)
  }

  export function pluralize(count: number, singular: string, plural: string): string {
    const template = count === 1 ? singular : plural
    return template.replace("{}", count.toString())
  }

  export function stripMarkdown(str: string): string {
    return str
      .replace(/\*\*(.+?)\*\*/g, "$1") // Bold **text**
      .replace(/\*(.+?)\*/g, "$1") // Italic *text*
      .replace(/__(.+?)__/g, "$1") // Bold __text__
      .replace(/_(.+?)_/g, "$1") // Italic _text_
      .replace(/`(.+?)`/g, "$1") // Inline code `code`
      .replace(/\[(.+?)\]\(.+?\)/g, "$1") // Links [text](url)
      .replace(/^#+\s+/gm, "") // Headers
  }
}
