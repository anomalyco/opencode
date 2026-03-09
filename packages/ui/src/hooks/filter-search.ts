import fuzzysort from "fuzzysort"

type Row<T> = { val: T; text: string; ord: number }

export const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKC")
    .replaceAll(",", ".")
    .replace(/[\s._\-/\\]+/g, "")

const pull = (value: unknown, key: string) => {
  let node = value
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return ""
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return String(node)
  return ""
}

const build = <T>(list: T[], keys?: string[]) => {
  if (!keys || keys.length === 0) {
    return list.map((val, ord) => ({ val, ord, text: normalize(String(val)) }))
  }
  return list.map((val, ord) => ({
    val,
    ord,
    text: normalize(keys.map((key) => pull(val, key)).join(" ")),
  }))
}

export const fuzzy = <T>(needle: string, list: T[], keys?: string[]) => {
  const rows = build(list, keys)
  return Array.from(fuzzysort.go(needle, rows, { key: "text" }))
    .sort((a, b) => {
      const ab = Number(a.obj.text.startsWith(needle))
      const bb = Number(b.obj.text.startsWith(needle))
      if (ab !== bb) return bb - ab
      if (a.score !== b.score) return b.score - a.score
      return a.obj.ord - b.obj.ord
    })
    .map((hit) => hit.obj.val)
}
