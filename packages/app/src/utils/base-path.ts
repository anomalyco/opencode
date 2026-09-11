export function appBasePath() {
  if (typeof window === "undefined") return ""
  const injected = window.__OPENCODE_BASE_PATH__
  if (injected !== undefined) return injected.replace(/\/+$/, "")
  const base = document.querySelector("base[href]")
  if (!base) return ""
  const url = new URL(base.getAttribute("href")!, location.href)
  return url.origin === location.origin ? url.pathname.replace(/\/+$/, "") : ""
}

export function serverRequestURL(server: string, path: string) {
  const base = new URL(server)
  base.pathname = base.pathname.replace(/\/+$/, "") + "/"
  return new URL(path.replace(/^\/+/, ""), base)
}

// Solid Router's location includes its base, while application route parsers do not.
export function appPath(pathname: string) {
  const base = appBasePath()
  if (base && pathname === base) return "/"
  if (base && pathname.startsWith(base + "/")) return pathname.slice(base.length)
  return pathname
}
