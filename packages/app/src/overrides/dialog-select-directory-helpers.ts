export type FileNode = {
  name: string
  absolute: string
  type: string
}

export type Row = {
  absolute: string
  search: string
}

export function processProjectEntries(nodes: FileNode[]): Row[] {
  return nodes
    .filter((n) => n.type === "directory")
    .map((n) => ({
      absolute: n.absolute.replace(/\/+$/, ""),
      search: n.name,
    }))
}

export function validateProjectName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return "Enter a project name first."
  return null
}

export function resolveSelection(absolute: string, multiple?: boolean): string | string[] {
  return multiple ? [absolute] : absolute
}
