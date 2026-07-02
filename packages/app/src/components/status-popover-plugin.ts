export const formatPluginName = (value: string) => {
  if (!/^(file:|file:\/\/|\.{1,2}\/|\/|~\/|[A-Za-z]:[\\/])/.test(value)) {
    const localPackage = value.match(/^(.*)@(file|link|workspace):/)
    return localPackage?.[1] || value
  }

  const parts = value
    .replace(/^file:\/\//, "")
    .replace(/^file:/, "")
    .split(/[\\/]/)
    .filter(Boolean)
  const name = parts.at(-1)?.replace(/\.[cm]?[jt]sx?$/, "")

  if (!name) return value
  if (name === "index" && parts.length > 1) return parts.at(-2) ?? value
  return name
}
