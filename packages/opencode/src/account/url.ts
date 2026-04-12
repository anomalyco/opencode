export const normalizeServerUrl = (input: string): string => {
  const url = new URL(input)
  url.search = ""
  url.hash = ""

  const pathname = url.pathname.replace(/\/+$/, "")
  return pathname.length === 0 ? url.origin : `${url.origin}${pathname}`
}
