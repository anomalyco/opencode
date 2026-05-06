import path from "path"

function sliceAfterMatch(filePath: string, searchRoots: string[]) {
  const normalizedPath = filePath.replaceAll("\\", "/")
  const anchor = Math.max(normalizedPath.lastIndexOf("/.opencode/"), normalizedPath.lastIndexOf("/opencode/"))
  const match = searchRoots
    .map((searchRoot) => ({
      searchRoot: searchRoot.replaceAll("\\", "/"),
      index: normalizedPath.indexOf(searchRoot.replaceAll("\\", "/"), anchor === -1 ? 0 : anchor),
    }))
    .filter((item) => item.index !== -1)
    .toSorted((a, b) => a.index - b.index || b.searchRoot.length - a.searchRoot.length)[0]
  if (!match) return
  return normalizedPath.slice(match.index + match.searchRoot.length)
}

export function configEntryNameFromPath(filePath: string, searchRoots: string[]) {
  const candidate = sliceAfterMatch(filePath, searchRoots) ?? path.basename(filePath)
  const ext = path.extname(candidate)
  return ext.length ? candidate.slice(0, -ext.length) : candidate
}
