export function formatBaseHost(href: string) {
  try {
    return `${new URL(href).host}/`
  } catch {
    return href.endsWith("/") ? href : `${href}/`
  }
}

export function formatEditablePath(loc: { pathname: string; search: string; hash: string }) {
  const pathname = loc.pathname || "/"
  const tail = pathname === "/" ? "" : pathname.slice(1)
  return tail + loc.search + loc.hash
}

export function resolveNavigatePath(base: string, input: string) {
  const trimmed = input.trim()
  if (!trimmed) return new URL("/", base).toString()
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return new URL(path, base).toString()
}
