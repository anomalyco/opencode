import path from "path"

export function abbreviateHome(input: string, home: string) {
  if (!home) return input
  const relative = path.relative(home, input)
  if (relative === "") return "~"
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return input
  return "~" + path.sep + relative
}

/** Split a display path into muted parent + emphasized leaf for the sidebar footer. */
export function splitDisplayPath(input: string) {
  if (!input) return { parent: "", name: "", sep: "/" }

  const sep = input.includes("\\") ? "\\" : "/"
  const parts = input.split(sep)
  if (parts.length === 1) return { parent: "", name: input, sep }

  const name = parts.at(-1) ?? ""
  const parent = parts.slice(0, -1).join(sep)
  if (!parent && !name) return { parent: "", name: input, sep }
  return { parent, name, sep }
}
