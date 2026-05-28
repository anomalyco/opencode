export function apiUrl(base: string, path: string) {
  const root = base.replace(/\/+$/, "")
  const leaf = path.replace(/^\/+/, "")
  return new URL(`${root}/${leaf}`)
}
